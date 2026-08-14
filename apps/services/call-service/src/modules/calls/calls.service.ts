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
import { envOr, unreachableFromCaller } from '@nexora/config';
import { resolveChannelAccess } from '@nexora/database';
import { PERMISSIONS } from '@nexora/permissions';
import type { CallTokenResponse } from '@nexora/shared-types';
import { livekitKeyStatusForJoin } from '../../livekit-check';

const TOKEN_TTL = '2h';

@Injectable()
export class CallsService {
  /** Room per channel, so a channel's call is discoverable without extra state. */
  private roomName(channelId: string): string {
    return `channel.${channelId}`;
  }

  /**
   * `requestHost` is the caller's own `Host` header - the address it reached this
   * deployment on, which Nginx forwards. It is here only to catch an SFU address
   * that client could never dial; see the `LIVEKIT_UNREACHABLE_URL` check below.
   */
  async token(
    user: { id: string; username: string },
    channelId: string,
    requestHost?: string,
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

    // Nor does handing out an address the client cannot dial. A loopback
    // `LIVEKIT_URL` tells every client to look for the SFU on its own machine:
    // right for `pnpm dev`, and right for a browser on the server, which is
    // exactly why it survives testing - the operator connects a call locally and
    // the first phone on the network gets `ERR_CONNECTION_REFUSED` behind
    // "could not establish signal connection: Failed to fetch". Note that a
    // container keeps the environment it was created with, so a `.env` corrected
    // after the fact changes nothing until call-service is recreated.
    if (unreachableFromCaller(url, requestHost)) {
      throw new ServiceUnavailableException({
        code: 'LIVEKIT_UNREACHABLE_URL',
        message:
          `This deployment advertises the voice server at ${url}, which only a client on the ` +
          'server itself can reach. Set LIVEKIT_URL=/livekit - the gateway proxies it, so the ' +
          'address follows whoever is calling - and recreate call-service.',
      });
    }

    // Handing out a token the SFU is known to reject buys nothing: the client
    // gets "invalid token: <400 characters of JWT>" and the operator gets no
    // clue. Say what is wrong while there is still a place to say it.
    if ((await livekitKeyStatusForJoin()) === 'rejected') {
      throw new ServiceUnavailableException({
        code: 'LIVEKIT_KEY_MISMATCH',
        message:
          'The voice server rejects this deployment signing key. Recreate the LiveKit container so it picks up LIVEKIT_API_SECRET (see call-service logs).',
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
