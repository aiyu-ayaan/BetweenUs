import { IsUUID } from 'class-validator';
import type { CallTokenRequest } from '@nexora/shared-types';

export class CallTokenDto implements CallTokenRequest {
  @IsUUID()
  channelId!: string;
}
