import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type {
  CreateMessageRequest,
  ReactToMessageRequest,
  UpdateMessageRequest,
} from '@nexora/shared-types';

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
