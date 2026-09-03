/**
 * The status endpoints: post one, read the tray, mark one seen, see who saw
 * yours, take one down.
 *
 * Posting is one request carrying both the bytes and the caption, unlike an
 * attachment, which is uploaded first and claimed by a message later. Two
 * steps exist there because a message can carry several files and is composed
 * over time; a status is one file and one button, and a two-step version of it
 * leaves an orphaned blob every time somebody changes their mind between the
 * two steps.
 *
 * Everything a post says is sealed by the time it arrives: the caption is an
 * envelope, the file is ciphertext, and the bundle of wraps that decides who
 * may open it comes with them. So this controller no longer looks inside
 * anything - it cannot - and the checks that used to read the bytes have gone
 * with the plaintext they needed. `GET audience` is the other half: the
 * directory a client wraps against before it posts.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform, plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import { MAX_UPLOAD_BYTES, buildKey, getStorage } from '@betweenus/storage';
import {
  STATUS_CAPTION_SEALED_MAX_LENGTH,
  STATUS_VIDEO_MAX_MS,
  type CreateStatusRequest,
  type DeviceKey,
  type StatusEntry,
  type StatusFeed,
  type StatusKeyEntry,
  type StatusKind,
  type StatusViewer,
} from '@betweenus/shared-types';
import { StatusService } from './status.service';

/** Ciphertext has no type of its own, and claiming one would be a lie. */
const OPAQUE = 'application/octet-stream';

/** A serialised ECDH P-256 JWK is ~200 chars; the cap is slack, not a guess. */
const MAX_PUBLIC_KEY_LENGTH = 1024;

/** Client-minted and opaque here, exactly as in the e2ee module's DTO. */
const MAX_DEVICE_ID_LENGTH = 128;

/** One wrap of the post's key, for one device. */
export class StatusKeyEntryDto implements StatusKeyEntry {
  @IsUUID()
  recipientUserId!: string;

  @IsString()
  @Length(1, MAX_DEVICE_ID_LENGTH)
  recipientDeviceId!: string;

  @IsString()
  @Length(1, MAX_PUBLIC_KEY_LENGTH)
  senderPublicKey!: string;

  @IsString()
  @Length(1, 512)
  wrappedKey!: string;

  @IsString()
  @Length(1, 64)
  iv!: string;
}

/**
 * A multipart body arrives as strings, so the numbers are converted before
 * they are validated rather than after - `@IsInt` on the string `"4000"` fails,
 * and the failure reads as "durationMs must be an integer" for a client that
 * sent an integer.
 */
export class CreateStatusDto implements CreateStatusRequest {
  @IsIn(['PHOTO', 'VIDEO', 'TEXT'])
  kind!: StatusKind;

  /**
   * The sealed caption, not the words - so the cap is on the envelope and the
   * readable length is the composer's business. The server cannot count
   * characters in a ciphertext and must not pretend to.
   */
  @IsOptional()
  @IsString()
  @MaxLength(STATUS_CAPTION_SEALED_MAX_LENGTH)
  caption?: string;

  /** The IV the file was sealed with. Required with a file, refused without. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  mediaIv?: string;

  /**
   * What the sealed bytes are once opened. Stored and returned as sent: it is
   * a hint for the client's decoder, never a claim about what is on disk -
   * what is on disk is ciphertext.
   */
  @IsOptional()
  @IsString()
  @Length(1, 128)
  mediaType?: string;

  @IsString()
  @Length(1, MAX_DEVICE_ID_LENGTH)
  senderDeviceId!: string;

  /**
   * The wraps. Arrives as a JSON string because the rest of the post is
   * multipart, and multipart has no arrays - the shape is validated below
   * exactly as if it had come in as JSON.
   *
   * The ceiling is a friend list times its devices. Bigger than that is not a
   * person with a lot of friends, it is somebody probing the endpoint.
   */
  @Transform(({ value }) => parseKeys(value))
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  keys!: StatusKeyEntryDto[];

  /**
   * Validated as a hex colour rather than against `STATUS_BACKGROUNDS`: the
   * palette is a client's choice of eight, and pinning the server to that list
   * would mean a deployment cannot add a ninth without a release of both.
   */
  @IsOptional()
  @IsHexColor()
  background?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(STATUS_VIDEO_MAX_MS)
  durationMs?: number;
}

@Controller('statuses')
@UseGuards(JwtAuthGuard)
export class StatusController {
  constructor(private readonly statuses: StatusService) {}

  /** Your own run, and one row per friend who has posted. */
  @Get()
  feed(@CurrentUser() user: AuthenticatedUser): Promise<StatusFeed> {
    return this.statuses.feed(user.id);
  }

  /**
   * Posts one. `file` is required for PHOTO and VIDEO and refused for TEXT -
   * a text status with an attachment is a photo status somebody mislabelled,
   * and storing the file under a row that will never draw it is a blob no
   * sweep can name.
   */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStatusDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StatusEntry> {
    if (dto.kind === 'TEXT') {
      if (file) {
        throw new BadRequestException({
          code: 'UNEXPECTED_FILE',
          message: 'A text status carries no file',
        });
      }
      if (!dto.caption?.trim()) {
        throw new BadRequestException({
          code: 'EMPTY_STATUS',
          message: 'A text status needs something to say',
        });
      }
      // Whether it says anything is the only thing that can be asked of it -
      // the words are sealed, so "is it blank" is answered by the composer.
      return this.statuses.create(user.id, dto, null);
    }

    if (!file) {
      throw new BadRequestException({ code: 'NO_FILE', message: 'No file was uploaded' });
    }
    // Nothing here sniffs the bytes any more, because there is nothing to
    // sniff: the file arrives sealed, and a magic-number check on ciphertext
    // would refuse every real post. What the file is once opened is `mediaType`
    // - a hint the author sent, stored as sent, and never trusted as a fact
    // about the object. The IV is what makes it openable at all, so a sealed
    // file without one is refused rather than stored unreadable for a day.
    if (!dto.mediaIv) {
      throw new BadRequestException({
        code: 'NO_MEDIA_IV',
        message: 'A sealed file needs the IV it was sealed with',
      });
    }

    // Under `status/`, which is the prefix the download route reads to know
    // this object is gated by a status key rather than by channel access.
    // Never under `attachments/`: that prefix means "claimed by a message or
    // by nobody", and a status is neither. No extension, for the same reason
    // an attachment has none - the name would describe the plaintext.
    const key = buildKey(`status/${user.id}`, '');
    const object = await getStorage().put(key, file.buffer, OPAQUE);
    return this.statuses.create(user.id, dto, object.key);
  }

  /**
   * Every device this account may seal a post for, right now: its own, and
   * every friend's.
   *
   * Read immediately before posting rather than cached, because this list *is*
   * the audience - a friend added a minute ago should be in it, and one who
   * blocked the caller a minute ago should not.
   */
  @Get('audience')
  audience(@CurrentUser() user: AuthenticatedUser): Promise<DeviceKey[]> {
    return this.statuses.audienceDevices(user.id);
  }

  /** Records that this account opened one. Idempotent. */
  @Post(':statusId/view')
  @HttpCode(204)
  view(
    @CurrentUser() user: AuthenticatedUser,
    @Param('statusId', ParseUUIDPipe) statusId: string,
  ): Promise<void> {
    return this.statuses.markViewed(user.id, statusId);
  }

  /** Who opened one of yours. Refused to everybody but its author. */
  @Get(':statusId/views')
  viewers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('statusId', ParseUUIDPipe) statusId: string,
  ): Promise<StatusViewer[]> {
    return this.statuses.viewers(user.id, statusId);
  }

  @Delete(':statusId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('statusId', ParseUUIDPipe) statusId: string,
  ): Promise<void> {
    return this.statuses.remove(user.id, statusId);
  }
}

/**
 * The wrap bundle, out of the multipart field it travelled in, as real DTOs.
 *
 * `plainToInstance` is the whole point of this function, and leaving it out is
 * a bug that has already happened: a custom `@Transform` replaces the
 * conversion `@Type` would have done, so the entries stayed plain objects, the
 * global pipe's `forbidNonWhitelisted` found a class with no known properties,
 * and every post came back "keys.0.property recipientUserId should not exist".
 *
 * A parse failure becomes an empty array rather than a thrown error, so the
 * validator produces the ordinary "keys must be an array" refusal in the
 * standard error shape instead of a raw `SyntaxError` escaping the pipe.
 */
function parseKeys(value: unknown): unknown {
  const raw = typeof value === 'string' ? tryParse(value) : value;
  if (!Array.isArray(raw)) return raw;
  return plainToInstance(StatusKeyEntryDto, raw);
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
