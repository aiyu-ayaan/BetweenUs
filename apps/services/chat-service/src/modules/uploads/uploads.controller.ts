import {
  BadRequestException,
  Controller,
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
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import {
  MAX_UPLOAD_BYTES,
  assertSafeKey,
  buildKey,
  getStorage,
  isAllowedUpload,
  isInlineSafe,
  type StoredObject,
} from '@nexora/storage';

@Controller('uploads')
export class UploadsController {
  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StoredObject> {
    if (!file) {
      throw new BadRequestException({ code: 'NO_FILE', message: 'No file was uploaded' });
    }
    if (!isAllowedUpload(file.mimetype)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Content type ${file.mimetype} is not allowed`,
      });
    }

    // The key is generated from a UUID; the client filename only contributes an
    // extension, so an attacker cannot choose where the file lands.
    const key = buildKey(`attachments/${user.id}`, file.originalname);
    return getStorage().put(key, file.buffer, file.mimetype);
  }

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

    const storage = getStorage();
    if (!(await storage.exists(key))) {
      response.status(404).json({
        error: { code: 'OBJECT_NOT_FOUND', message: 'File not found', requestId: 'unknown' },
      });
      return;
    }

    const contentType = contentTypeFor(key);
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'private, max-age=86400');
    // Anything not provably safe to render (SVG, PDF, text) downloads instead of
    // executing in the app origin.
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

const EXTENSION_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

function contentTypeFor(key: string): string {
  const dot = key.lastIndexOf('.');
  const extension = dot >= 0 ? key.slice(dot).toLowerCase() : '';
  return EXTENSION_TYPES[extension] ?? 'application/octet-stream';
}
