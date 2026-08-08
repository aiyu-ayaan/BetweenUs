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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, JwtAuthGuard, openSecret, sealSecret, type AuthenticatedUser } from '@nexora/auth';
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
} from '@nexora/storage';
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
    return getStorage().put(key, file.buffer, OPAQUE);
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
      return object;
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
   */
  @Get(':key(*)')
  async download(@Param('key') key: string, @Res() response: Response): Promise<void> {
    try {
      assertSafeKey(key);
    } catch {
      throw new BadRequestException({ code: 'INVALID_KEY', message: 'Invalid object key' });
    }

    // Half-uploaded parts are scratch space, not objects anyone may read.
    if (key.startsWith(`${MULTIPART_PREFIX}/`)) {
      throw new BadRequestException({ code: 'INVALID_KEY', message: 'Invalid object key' });
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
