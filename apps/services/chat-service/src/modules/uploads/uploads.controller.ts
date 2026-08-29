/**
 * File upload and download.
 *
 * Two kinds of object pass through here.
 *
 * *Pictures* - avatars and server icons - arrive in the clear, because the
 * member list on every client has to render them without holding a channel
 * key. They are checked against an image allowlist and a small size cap, and
 * they are the only thing this service ever serves inline.
 *
 * *Attachments* arrive already encrypted under the channel key: the client
 * seals the file before the first byte leaves it, so what lands here is opaque.
 * That is what lets a channel carry any file at all - there is no content type
 * to allowlist - and it is why attachments always download rather than render.
 *
 * Anything over one request body's worth goes up in parts. The session that
 * ties the parts together is a sealed ticket held by the client, not state held
 * here, so a second chat-service replica can accept the next part.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  ForbiddenException,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { prisma, resolveChannelAccess } from '@betweenus/database';
import {
  CurrentUser,
  JwtAuthGuard,
  bearerToken,
  openSecret,
  sealSecret,
  verifyAccessToken,
  type AuthenticatedUser,
} from '@betweenus/auth';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_PICTURE_BYTES,
  MAX_UPLOAD_BYTES,
  MULTIPART_PREFIX,
  assertSafeKey,
  buildKey,
  getStorage,
  isAllowedPicture,
  isInlineSafe,
  type MultipartSession,
  type StoredObject,
  type UploadedPart,
} from '@betweenus/storage';
import {
  AbortMultipartDto,
  CompleteMultipartDto,
  StartMultipartDto,
  UploadPartDto,
} from './dto';

/** Ciphertext has no type of its own, and claiming one would be a lie. */
const OPAQUE = 'application/octet-stream';

/** How long a client has to finish an upload it started. */
const TICKET_TTL_MS = 6 * 60 * 60 * 1000;

interface TicketPayload extends MultipartSession {
  /** Who started it. A ticket is not transferable between accounts. */
  userId: string;
  expiresAt: number;
}

@Controller('uploads')
export class UploadsController {
  /**
   * An avatar or a server icon. The client has already downscaled it; this is
   * the check that the thing on the wire really is a small raster image.
   */
  @Post('picture')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PICTURE_BYTES, files: 1 } }))
  async uploadPicture(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StoredObject> {
    if (!file) {
      throw new BadRequestException({ code: 'NO_FILE', message: 'No file was uploaded' });
    }
    if (!isAllowedPicture(file.mimetype)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Content type ${file.mimetype} is not allowed for a picture`,
      });
    }

    const key = buildKey(`pictures/${user.id}`, file.originalname);
    return getStorage().put(key, file.buffer, file.mimetype.split(';')[0]!.trim());
  }

  /** An encrypted attachment small enough to arrive in one request. */
  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StoredObject> {
    if (!file) {
      throw new BadRequestException({ code: 'NO_FILE', message: 'No file was uploaded' });
    }

    // The key is generated from a UUID; the client filename never reaches it,
    // so an attacker cannot choose where the file lands. The real name travels
    // inside the encrypted message instead.
    const key = buildKey(`attachments/${user.id}`, '');
    const object = await getStorage().put(key, file.buffer, OPAQUE);
    return record(object, user.id);
  }

  // --- Multipart --------------------------------------------------------------

  @Post('multipart')
  @UseGuards(JwtAuthGuard)
  async startMultipart(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartMultipartDto,
  ): Promise<{ ticket: string; maxPartBytes: number }> {
    if (dto.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `Attachments are limited to ${MAX_ATTACHMENT_BYTES} bytes`,
      });
    }

    const key = buildKey(`attachments/${user.id}`, '');
    const session = await getStorage().createMultipart(key, OPAQUE);
    return { ticket: issueTicket(session, user.id), maxPartBytes: MAX_UPLOAD_BYTES };
  }

  @Post('multipart/part')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async uploadPart(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadPartDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadedPart> {
    if (!file) {
      throw new BadRequestException({ code: 'NO_FILE', message: 'No part was uploaded' });
    }
    const session = openTicket(dto.ticket, user.id);
    const partNumber = Number(dto.partNumber);

    try {
      return await getStorage().uploadPart(session, partNumber, file.buffer);
    } catch (error) {
      throw new BadRequestException({
        code: 'PART_REJECTED',
        message: error instanceof Error ? error.message : 'The part was not stored',
      });
    }
  }

  @Post('multipart/complete')
  @UseGuards(JwtAuthGuard)
  async completeMultipart(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CompleteMultipartDto,
  ): Promise<StoredObject> {
    const session = openTicket(dto.ticket, user.id);

    try {
      const object = await getStorage().completeMultipart(session, dto.parts);
      if (object.size > MAX_ATTACHMENT_BYTES) {
        // The declared size was a promise; this is the measurement. A client
        // that sent more parts than it announced does not get to keep them.
        await getStorage().delete(object.key);
        throw new BadRequestException({
          code: 'FILE_TOO_LARGE',
          message: `Attachments are limited to ${MAX_ATTACHMENT_BYTES} bytes`,
        });
      }
      return await record(object, user.id);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException({
        code: 'UPLOAD_INCOMPLETE',
        message: error instanceof Error ? error.message : 'The upload could not be assembled',
      });
    }
  }

  @Delete('multipart')
  @UseGuards(JwtAuthGuard)
  async abortMultipart(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AbortMultipartDto,
  ): Promise<{ aborted: true }> {
    const session = openTicket(dto.ticket, user.id);
    await getStorage()
      .abortMultipart(session)
      // An upload that was never written to has nothing to abort, and the
      // client that gave up on it should not have to care.
      .catch(() => undefined);
    return { aborted: true };
  }

  // --- Download ---------------------------------------------------------------

  /**
   * Serves objects written by the local driver. With S3 configured the client
   * fetches the bucket URL directly and never reaches this route - it stays
   * mounted so the same message URLs keep working after a driver switch.
   *
   * Authentication is asked for on an attachment and not on a picture, and the
   * split is deliberate rather than an oversight.
   *
   * An attachment is ciphertext, so an unauthenticated read leaked nothing
   * readable - but "nothing readable" is not the same as "nothing". It leaked
   * the bytes and their size to anybody who ever saw the URL: a proxy log, a
   * browser history, a screenshot of a devtools panel. The key is an unguessable
   * UUID, so this was a capability URL, and a capability URL that never expires
   * is one leak away from permanent. The clients already send the header.
   *
   * Holding *a* session is not the same as being entitled to this object,
   * though, and for a while it was treated as if it were: any signed-in account
   * that came by a key could fetch the bytes behind it. So the row is consulted
   * as well - the uploader, or somebody who can see the channel the message
   * carrying it was sent to. It is still ciphertext either way; this is the
   * layer that stops a leaked key being a leaked file.
   *
   * A picture - an avatar, a server icon - is drawn by an `<img>` tag, which
   * cannot carry an Authorization header. Requiring one there would mean every
   * avatar in the app failing to load. It stays public, which
   * development/E2EE.md has always said it is.
   */
  @Get(':key(*)')
  async download(
    @Param('key') key: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      assertSafeKey(key);
    } catch {
      throw new BadRequestException({ code: 'INVALID_KEY', message: 'Invalid object key' });
    }

    // Half-uploaded parts are scratch space, not objects anyone may read - and
    // that is true of the account that uploaded them too, so it is settled
    // before identity is looked at rather than after. Below the ownership check
    // this could never fire: `mayRead` wants an attachment row, a part has
    // none, and every request for one was refused as somebody else's file
    // rather than as the invalid key it is.
    if (key.startsWith(`${MULTIPART_PREFIX}/`)) {
      throw new BadRequestException({ code: 'INVALID_KEY', message: 'Invalid object key' });
    }

    if (!key.startsWith('pictures/')) {
      const userId = callerId(request);
      if (!userId) {
        throw new UnauthorizedException({
          code: 'UNAUTHORIZED',
          message: 'Sign in to fetch this object',
        });
      }
      if (!(await mayRead(userId, key))) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'This file is not yours to fetch',
        });
      }
    }

    const storage = getStorage();
    if (!(await storage.exists(key))) {
      response.status(404).json({
        error: { code: 'OBJECT_NOT_FOUND', message: 'File not found', requestId: 'unknown' },
      });
      return;
    }

    // Only a picture is ever rendered in the app origin, and only because its
    // type was checked on the way in. An attachment is ciphertext: it is served
    // as bytes, and the client decrypts it in memory.
    const contentType = key.startsWith('pictures/') ? contentTypeFor(key) : OPAQUE;
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'private, max-age=86400');
    response.setHeader(
      'Content-Disposition',
      isInlineSafe(contentType) ? 'inline' : 'attachment',
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = await storage.get(key);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}

/**
 * Notes an uploaded blob so something can eventually collect it.
 *
 * Every attachment starts unclaimed. Sending a message claims the keys it
 * carries; anything still unclaimed when the grace period runs out was an
 * upload nobody sent, and the sweeper removes it either way. Recording it is
 * therefore not optional bookkeeping - a blob with no row is a blob no sweep
 * can ever name - so a failure here undoes the upload rather than leaving one
 * behind for ever.
 */
async function record(object: StoredObject, userId: string): Promise<StoredObject> {
  try {
    await prisma.attachment.create({
      data: { key: object.key, uploaderId: userId, size: object.size },
    });
  } catch (error) {
    await getStorage().delete(object.key).catch(() => undefined);
    throw new BadRequestException({
      code: 'UPLOAD_NOT_RECORDED',
      message: error instanceof Error ? error.message : 'The upload could not be recorded',
    });
  }
  return object;
}

/**
 * The multipart session, sealed so the client can hold it. Sealing rather than
 * storing means no session table, no Redis key, and no affinity between the
 * client and whichever replica answered the last request.
 */
function issueTicket(session: MultipartSession, userId: string): string {
  const payload: TicketPayload = { ...session, userId, expiresAt: Date.now() + TICKET_TTL_MS };
  return sealSecret(JSON.stringify(payload));
}

function openTicket(ticket: string, userId: string): MultipartSession {
  const raw = openSecret(ticket);
  if (!raw) {
    throw new BadRequestException({ code: 'INVALID_TICKET', message: 'Unknown upload' });
  }

  const payload = JSON.parse(raw) as TicketPayload;
  // A sealed ticket cannot be forged, but it can be replayed by whoever it
  // leaked to; bind it to the account that started the upload, and to a clock.
  if (payload.userId !== userId) {
    throw new BadRequestException({ code: 'INVALID_TICKET', message: 'Unknown upload' });
  }
  if (payload.expiresAt < Date.now()) {
    throw new BadRequestException({ code: 'UPLOAD_EXPIRED', message: 'This upload has expired' });
  }

  return { key: payload.key, contentType: payload.contentType, externalId: payload.externalId };
}

const EXTENSION_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function contentTypeFor(key: string): string {
  const dot = key.lastIndexOf('.');
  const extension = dot >= 0 ? key.slice(dot).toLowerCase() : '';
  return EXTENSION_TYPES[extension] ?? OPAQUE;
}

/**
 * Who this request is, or null when it is nobody.
 *
 * `JwtAuthGuard` is the usual answer and is the wrong shape here: the guard
 * applies to a whole route, and this route serves two kinds of object with two
 * different rules - a picture is public because an `<img>` tag cannot send a
 * header, an attachment is not. So the check is a function rather than a
 * decorator, and it is the same verification the guard performs.
 */
function callerId(request: Request): string | null {
  const token = bearerToken(request.headers.authorization);
  if (!token) return null;
  try {
    return verifyAccessToken(token).sub;
  } catch {
    return null;
  }
}

/**
 * Whether this account is entitled to the object behind a key.
 *
 * Every attachment has a row - `record` makes sure of it, and undoes the upload
 * rather than leave one without - so a key with no row is a key to nothing, and
 * an unclaimed upload belongs to whoever made it and to nobody else. Once a
 * message carries it, the question becomes the same one the message itself
 * answers: can this account see that channel. `resolveChannelAccess` is where
 * that already lives, private channels and direct messages included.
 */
async function mayRead(userId: string, key: string): Promise<boolean> {
  const row = await prisma.attachment.findUnique({
    where: { key },
    select: {
      uploaderId: true,
      message: {
        select: {
          id: true,
          channelId: true,
          authorId: true,
          viewOnce: true,
          views: { where: { userId }, select: { id: true } },
        },
      },
    },
  });
  if (!row) return false;

  // A one-time message is the one case where holding the upload is not a
  // licence to read it, so the ownership shortcut below has to be gated
  // before it fires rather than after.
  if (row.message?.viewOnce) return mayOpenOneTime(userId, row.message);

  if (row.uploaderId === userId) return true;
  if (!row.message) return false;
  return (await resolveChannelAccess(userId, row.message.channelId)) !== null;
}

/**
 * Whether this account may fetch the bytes of a one-time message, which is a
 * narrower question than whether it may see the channel.
 *
 * This is where "one look" is actually enforced. Everything the clients do -
 * a card that locks, a viewer that will not open twice - is a client being
 * well behaved, and a one-time message whose only guarantee is that the
 * recipient's software chose to keep it is not a guarantee at all. The rule
 * lives here because this is the one door the bytes come through.
 *
 * Two refusals, and the first is the one people ask about:
 *
 * **The author may not read it back.** They sent it; it was never theirs to
 * re-open, and a sender who can look at it again on another device has a
 * message that is one-time for exactly one of the two people in the
 * conversation. It is also the case the clients cannot enforce on their own,
 * because the author is the account holding the plaintext to begin with.
 *
 * **Nobody may read it twice.** A view row exists from the moment somebody
 * spends their look, so the second fetch is refused however the request was
 * made - a rebuilt client, a replayed URL, a second device.
 *
 * The order matters: the look is recorded *after* the fetch, so the fetch that
 * spends it still succeeds and only the ones after it do not.
 */
function mayOpenOneTime(
  userId: string,
  message: { authorId: string; channelId: string; views: Array<{ id: string }> },
): Promise<boolean> {
  if (!oneTimeLookLeft(userId, message.authorId, message.views.length)) {
    return Promise.resolve(false);
  }
  return resolveChannelAccess(userId, message.channelId).then((access) => access !== null);
}

/**
 * Whether this account has a look left in a one-time message, before channel
 * access is even considered.
 *
 * Split out from the query so the rule can be asserted on without a database.
 * It is two comparisons and it is the whole of the guarantee, which is exactly
 * the kind of thing that gets "simplified" by somebody who reads the author
 * check as a redundant special case of the view check.
 */
export function oneTimeLookLeft(userId: string, authorId: string, viewsByCaller: number): boolean {
  // The author sent it. It was never theirs to re-open, and a sender who can
  // look again on another device has a message that is one-time for exactly
  // one of the two people in the conversation.
  if (userId === authorId) return false;
  // Spent. The row is written the moment somebody looks, so every fetch after
  // the first is refused however it was made.
  return viewsByCaller === 0;
}
