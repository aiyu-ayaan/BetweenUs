import { IsUUID } from 'class-validator';
import type { CallIceRequest } from '@nexora/shared-types';

export class CallIceDto implements CallIceRequest {
  @IsUUID()
  channelId!: string;
}
