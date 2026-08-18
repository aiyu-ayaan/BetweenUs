import { IsUUID } from 'class-validator';
import type { CallIceRequest } from '@betweenus/shared-types';

export class CallIceDto implements CallIceRequest {
  @IsUUID()
  channelId!: string;
}
