import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { CreateMessageRequest } from '@nexora/shared-types';

export class CreateMessageDto implements CreateMessageRequest {
  @IsUUID()
  channelId!: string;

  @IsString()
  @Length(1, 4000)
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
