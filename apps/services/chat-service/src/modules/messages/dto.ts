import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import type {
  ClearChatsRequest,
  CreateMessageRequest,
  ReactToMessageRequest,
  UpdateMessageRequest,
} from '@betweenus/shared-types';

export class CreateMessageDto implements CreateMessageRequest {
  @IsUUID()
  channelId!: string;

  /**
   * Ciphertext envelope, not plaintext - see development/E2EE.md. The ceiling
   * is generous because the envelope also carries the attachment manifest:
   * a key, a name, a size and a content type per file, all encrypted.
   */
  @IsString()
  @Length(1, 32000)
  content!: string;

  /**
   * Which uploaded blobs this message claims. Only keys this account uploaded
   * and nothing else has claimed are taken; anything else is ignored rather
   * than refused, because a message is not worth failing over a stale key.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  attachmentKeys?: string[];

  /**
   * Send this as a one-time message: its media may be opened once by somebody
   * other than the author, and that opening destroys the row and its blobs.
   *
   * The one thing about a message the server is told in the clear besides who
   * sent it and when, and it has to be: burning is a row update and a blob
   * delete, neither of which a server that cannot read the body can be asked
   * to do by the body.
   */
  @IsOptional()
  @IsBoolean()
  viewOnce?: boolean;
}

export class UpdateMessageDto implements UpdateMessageRequest {
  /** The replacement envelope, same shape and same ceiling as the original. */
  @IsString()
  @Length(1, 32000)
  content!: string;
}

export class ReactToMessageDto implements ReactToMessageRequest {
  /**
   * The emoji itself. The service checks it further - no whitespace, and short
   * enough to be one symbol rather than a paragraph.
   */
  @IsString()
  @Length(1, 32)
  emoji!: string;
}

export class MessageQueryDto {
  @IsUUID()
  channelId!: string;

  /** Message id to page backwards from. */
  @IsOptional()
  @IsUUID()
  before?: string;
}

export class PinQueryDto {
  @IsUUID()
  channelId!: string;
}

/**
 * What to clear. An absent or null `channelId` means every conversation, which
 * is what an older client that sends no body at all also means.
 */
export class ClearChatsDto implements ClearChatsRequest {
  @IsOptional()
  @IsUUID()
  channelId?: string | null;
}
