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
import { Transform } from 'class-transformer';
import { IsHexColor, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import {
  MAX_UPLOAD_BYTES,
  buildKey,
  detectPictureType,
  detectVideoType,
  getStorage,
} from '@betweenus/storage';
import {
  STATUS_CAPTION_MAX_LENGTH,
  STATUS_VIDEO_MAX_MS,
  type CreateStatusRequest,
  type StatusEntry,
  type StatusFeed,
  type StatusKind,
  type StatusViewer,
} from '@betweenus/shared-types';
import { StatusService } from './status.service';

/**
 * A multipart body arrives as strings, so the numbers are converted before
 * they are validated rather than after - `@IsInt` on the string `"4000"` fails,
 * and the failure reads as "durationMs must be an integer" for a client that
 * sent an integer.
 */
export class CreateStatusDto implements CreateStatusRequest {
  @IsIn(['PHOTO', 'VIDEO', 'TEXT'])
  kind!: StatusKind;

  @IsOptional()
  @IsString()
  @MaxLength(STATUS_CAPTION_MAX_LENGTH)
  caption?: string;

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
      return this.statuses.create(user.id, dto, null);
    }

    if (!file) {
      throw new BadRequestException({ code: 'NO_FILE', message: 'No file was uploaded' });
    }

    // The bytes, not the header - the same rule the picture route follows, and
    // for the same reason: `file.mimetype` is a value the client chose.
    const detected =
      dto.kind === 'PHOTO' ? detectPictureType(file.buffer) : detectVideoType(file.buffer);
    if (!detected) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message:
          dto.kind === 'PHOTO'
            ? 'That file is not a PNG, JPEG, GIF or WebP'
            : 'That file is not an MP4 or WebM video',
      });
    }

    // Under `status/`, which is the prefix the download route reads to know
    // this object is gated by friendship. Never under `attachments/`: that
    // prefix means "claimed by a message or by nobody", and a status is
    // neither.
    const key = buildKey(`status/${user.id}`, `status${detected.extension}`);
    const object = await getStorage().put(key, file.buffer, detected.contentType);
    return this.statuses.create(user.id, dto, object.key);
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
