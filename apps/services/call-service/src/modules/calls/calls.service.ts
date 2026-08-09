/**
 * Mints LiveKit access tokens for channel calls.
 *
 * This service decides *who may join which room*. It never sees media: the
 * client dials LiveKit directly, and the media itself is end-to-end encrypted
 * with the channel key, which the server never holds.
 */
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccessToken } from 'livekit-server-sdk';
import { envOr } from '@nexora/config';
import { resolveChannelAccess } from '@nexora/database';
import { PERMISSIONS } from '@nexora/permissions';
import type { CallTokenResponse } from '@nexora/shared-types';

const TOKEN_TTL = '2h';

@Injectable()
export class CallsService {
  /** Room per channel, so a channel's call is discoverable without extra state. */
  private roomName(channelId: string): string {
    return `channel.${channelId}`;
  }

  async token(
    user: { id: string; username: string },
    channelId: string,
  ): Promise<CallTokenResponse> {
    await this.requireChannelAccess(user.id, channelId);

    const apiKey = envOr('LIVEKIT_API_KEY', '');
    const apiSecret = envOr('LIVEKIT_API_SECRET', '');
    // Absolute (ws://host:7880) or a path on the gateway (/livekit); the client
    // resolves the second against the address it is already talking to, so a
    // deployment behind one hostname stays one hostname.
    const url = envOr('LIVEKIT_URL', '');
    if (!apiKey || !apiSecret || !url) {
      throw new ServiceUnavailableException({
        code: 'LIVEKIT_NOT_CONFIGURED',
        message: 'Calls are not configured on this deployment',
      });
    }

    const room = this.roomName(channelId);
    const grant = new AccessToken(apiKey, apiSecret, {
      identity: user.id,
      name: user.username,
      ttl: TOKEN_TTL,
    });
    grant.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return { url, token: await grant.toJwt(), room, identity: user.id };
  }

  /**
   * The same resolver chat- and presence-service use, so a private channel or a
   * revoked permission takes effect here at the same moment it does there.
   */
  private async requireChannelAccess(userId: string, channelId: string): Promise<void> {
    const access = await resolveChannelAccess(userId, channelId);
    if (!access) {
      // 404, not 403: a non-member must not learn the channel exists.
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }

    if (!access.permissions.includes(PERMISSIONS.START_CALL)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: `Missing permission ${PERMISSIONS.START_CALL}`,
      });
    }
  }
}
