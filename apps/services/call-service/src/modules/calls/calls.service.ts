/**
 * Decides who may join a channel's call, and hands out ICE servers.
 *
 * That is the whole of it. There is no room to create, no token to sign and no
 * media server address to advertise, because media goes directly between the
 * participants - see `call.gateway.ts` for the introduction and `ice.ts` for
 * how a path between them is found.
 *
 * The permission check lives here as well as in the gateway on purpose: the
 * client asks for ICE servers before it opens the signalling socket, so a
 * member who may not start a call finds out from a 403 rather than from a
 * socket that connects and then refuses.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { resolveChannelAccess } from '@nexora/database';
import { PERMISSIONS } from '@nexora/permissions';
import type { CallIceResponse } from '@nexora/shared-types';
import { iceServers } from '../../ice';

@Injectable()
export class CallsService {
  async ice(userId: string, channelId: string): Promise<CallIceResponse> {
    await this.requireChannelAccess(userId, channelId);
    return { iceServers: await iceServers() };
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
