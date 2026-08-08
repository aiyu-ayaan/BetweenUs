import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { CreateMessageRequest } from '@nexora/shared-types';

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

export class MessageQueryDto {
  @IsUUID()
  channelId!: string;

  /** Message id to page backwards from. */
  @IsOptional()
  @IsUUID()
  before?: string;
}
