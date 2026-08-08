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
import { prisma } from '@nexora/database';
import { PERMISSIONS, hasPermission } from '@nexora/permissions';
import type { CallTokenResponse, WorkspaceRole } from '@nexora/shared-types';

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
   * Duplicated from chat-service on purpose: each service owns its own
   * authorization decision, and this becomes a workspace-service call when the
   * shared Prisma schema is split (development/TODO.md).
   */
  private async requireChannelAccess(userId: string, channelId: string): Promise<void> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { workspaceId: true },
    });
    if (!channel) {
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: channel.workspaceId, userId } },
      select: { role: true },
    });
    if (!membership) {
      // 404, not 403: a non-member must not learn the channel exists.
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }

    if (!hasPermission(membership.role as WorkspaceRole, PERMISSIONS.START_CALL)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: `Missing permission ${PERMISSIONS.START_CALL}`,
      });
    }
  }
}
