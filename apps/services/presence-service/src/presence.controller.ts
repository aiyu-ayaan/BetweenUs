/**
 * Presence over HTTP, for the services that need a number rather than a stream.
 *
 * `server-service` has to answer "how many of this server's members are here
 * right now" when it describes an invite, and it has no business reading
 * presence out of Redis itself: presence belongs to this service, and a second
 * reader of `presence:online` is a second thing to change when that key does.
 *
 * It is not routed by the gateway. Nginx forwards the paths it names and
 * nothing else, and `/api/v1/internal` is not one of them, so this is reachable
 * on the internal Docker network and nowhere else. That is also why there is no
 * guard: there is no user here to authenticate, only another service.
 */
import { Controller, Get } from '@nestjs/common';
import { PresenceStore } from './presence.store';

@Controller('internal/presence')
export class PresenceController {
  constructor(private readonly store: PresenceStore) {}

  /**
   * Everyone online, as ids. Invisible users are already resolved to offline by
   * the store, so they are not in this list - being counted as present is
   * exactly what invisible means you are not.
   */
  @Get('online')
  async online(): Promise<{ userIds: string[] }> {
    const states = await this.store.onlineUsers();
    return { userIds: states.map((state) => state.userId) };
  }
}
