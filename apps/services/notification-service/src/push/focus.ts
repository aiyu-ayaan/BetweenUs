/**
 * Who is already reading the conversation, asked of presence-service.
 *
 * A push exists to reach somebody who is not looking. If the same account has
 * the channel open in a focused window on a laptop, waking their phone for it
 * is noise - the message is on a screen in front of them before the buzz
 * arrives. This is the half of that rule a server can answer, and the reason it
 * has to be a server that answers it: only the server can see the *other*
 * devices.
 *
 * Presence owns the fact and this only asks for it, over the same internal HTTP
 * path `server-service` already uses for online counts. Reading Redis directly
 * from here would make a key presence-service owns into a thing two services
 * have to agree about.
 *
 * Failure is not suppression. A presence-service that is slow, down or
 * unreachable answers "nobody", so the push goes: a missed notification is a
 * message somebody never learns about, and a redundant one is a buzz. The first
 * is much worse than the second.
 */
import { envOr } from '@betweenus/config';

/**
 * Short on purpose. This is on the path of every message fan-out, and a
 * presence-service that has stopped answering must not hold up everybody
 * else's notifications while it fails.
 */
const TIMEOUT_MS = 1_500;

const base = (): string => envOr('PRESENCE_SERVICE_URL', 'http://presence-service:3005');

export async function focusedAmong(channelId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const url = new URL(`${base()}/internal/presence/focus`);
  url.searchParams.set('channelId', channelId);
  url.searchParams.set('userIds', userIds.join(','));

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return new Set();
    const body = (await response.json()) as { focused?: string[] };
    return new Set(body.focused ?? []);
  } catch {
    // Deliberately silent about which failure it was. Every one of them means
    // the same thing here - assume nobody is reading, and send.
    return new Set();
  }
}
