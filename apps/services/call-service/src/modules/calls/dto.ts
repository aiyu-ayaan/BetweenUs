import { IsUUID } from 'class-validator';
import type {
  CallDeclineRequest,
  CallIceRequest,
  CallRingRequest,
} from '@betweenus/shared-types';

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

/**
 * Who declined is the authenticated user, so there is nothing here but the
 * channel. A decline that could name its own sender would be a way to silence
 * somebody else's phone.
 */
export class CallDeclineDto implements CallDeclineRequest {
  @IsUUID()
  channelId!: string;
}
