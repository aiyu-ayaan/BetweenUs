/**
 * How one socket is named inside Redis.
 *
 * Presence used to know accounts only, so two windows were one entry and
 * `live.totalSockets` could never exceed the account count. A socket is now a
 * member of `presence:sockets` (and of its account's own set), scored by its
 * last heartbeat exactly as `presence:online` is - so an instance that crashes
 * leaves sockets that age out instead of accounts online for ever.
 *
 * The member is `<userId>:<socketId>`. User ids are cuid/uuid and never contain
 * a colon, so the first colon is the split; the socket id is a random uuid.
 */
export function socketMember(userId: string, socketId: string): string {
  return `${userId}:${socketId}`;
}

export function parseSocketMember(member: string): { userId: string; socketId: string } | null {
  const at = member.indexOf(':');
  if (at <= 0 || at === member.length - 1) return null;
  return { userId: member.slice(0, at), socketId: member.slice(at + 1) };
}

/** Distinct accounts among socket members; unparseable members are ignored. */
export function distinctAccounts(members: string[]): number {
  const users = new Set<string>();
  for (const member of members) {
    const parsed = parseSocketMember(member);
    if (parsed) users.add(parsed.userId);
  }
  return users.size;
}

/**
 * An account is offline only when its last socket is gone. `remaining` is the
 * count of live sockets *left after* removing the one that closed, across every
 * instance.
 */
export function accountIsOffline(remaining: number): boolean {
  return remaining <= 0;
}
