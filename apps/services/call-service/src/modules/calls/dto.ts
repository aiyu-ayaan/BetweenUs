import { IsUUID } from 'class-validator';
import type { CallIceRequest, CallRingRequest } from '@betweenus/shared-types';

export class CallIceDto implements CallIceRequest {
  @IsUUID()
  channelId!: string;
}

export class CallRingDto implements CallRingRequest {
  @IsUUID()
  channelId!: string;

  /** Who to ring. Whether they may be rung is the service's question, not this one's. */
  @IsUUID()
  userId!: string;
}
