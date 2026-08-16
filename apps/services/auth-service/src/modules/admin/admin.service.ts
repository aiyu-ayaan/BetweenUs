/** Admin panel business logic: the user directory and the OAuth configuration. */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sealSecret } from '@nexora/auth';
import { Prisma, prisma } from '@nexora/database';
import type {
  AdminAuditEntry,
  AdminAuditPage,
  AdminOAuthProvider,
  AdminStatus,
  AdminUser,
  AdminUserPage,
  GlobalRole,
} from '@nexora/shared-types';
import { PROVIDERS, type ProviderName, callbackUrl } from './oauth-providers';
import type { AdminOAuthProviderDto, AdminUserUpdateDto } from './dto';

/** Page size cap, so a directory of any size cannot be pulled in one request. */
const MAX_TAKE = 100;

/** How many rows to ask the database for: one more than the page, see `paginate`. */
export function pageSize(take: number): number {
  return Math.min(Math.max(Math.trunc(take) || 1, 1), MAX_TAKE);
}

/**
 * Turns "one more row than asked for" into a page and a cursor.
 *
 * The extra row is never returned - it exists only to answer "is there another
 * page" without a second `count` over a table that may be large. The cursor is
 * the last row of the page the caller actually gets, so passing it back resumes
 * exactly where they stopped reading.
 */
export function paginate<T extends { id: string }>(
  rows: T[],
  size: number,
): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, size);
  return {
    page,
    nextCursor: rows.length > size ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Everything the panel shows for a user, in one query. */
const USER_DETAIL = {
  identities: { select: { provider: true } },
  _count: { select: { memberships: true } },
  // The newest live session is the closest thing to "last seen" without a
  // presence lookup across services.
  refreshTokens: {
    where: { revokedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdAt: true },
  },
} as const;

type UserWithDetail = Prisma.UserGetPayload<{ include: typeof USER_DETAIL }>;

function toAdminUser(user: UserWithDetail): AdminUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    disabledAt: user.disabledAt?.toISOString() ?? null,
    identities: user.identities.map((identity) => identity.provider),
    serverCount: user._count.memberships,
    lastSeenAt: user.refreshTokens[0]?.createdAt.toISOString() ?? null,
  };
}

type AuditRow = Prisma.AdminAuditGetPayload<{
  include: { actor: { select: { username: true } } };
}>;

function toAuditEntry(row: AuditRow): AdminAuditEntry {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    actorLabel: row.actor ? `@${row.actor.username}` : null,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    detail: (row.detail as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Appends to the trail.
 *
 * Deliberately never throws: an audit row that cannot be written must not undo
 * the action it describes - a disabled account that stayed enabled because the
 * log was full is worse than a missing line.
 */
async function record(
  actorId: string,
  action: string,
  targetId: string | null,
  targetLabel: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await prisma.adminAudit
    .create({
      data: { actorId, action, targetId, targetLabel, detail: (detail ?? undefined) as never },
    })
    .catch(() => undefined);
}

@Injectable()
export class AdminService {
  /** Public: the panel uses it to explain `pnpm admin:create` when nobody exists. */
  async status(): Promise<AdminStatus> {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', disabledAt: null } });
    return { hasAdmin: admins > 0 };
  }

  /**
   * One page of the directory.
   *
   * Paged by cursor rather than by offset. The order is newest first and
   * accounts keep being created, so an offset shifts under the reader: an
   * account registered between two requests pushes the whole list down one and
   * page two opens with the row page one ended on. A cursor names a row, so
   * nothing before it can move.
   */
  async users(query: string | undefined, take: number, cursor?: string): Promise<AdminUserPage> {
    const trimmed = query?.trim();
    const where = trimmed
      ? {
          OR: [
            { email: { contains: trimmed, mode: 'insensitive' as const } },
            { username: { contains: trimmed, mode: 'insensitive' as const } },
            { displayName: { contains: trimmed, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const size = pageSize(take);
    const rows = await prisma.user.findMany({
      where,
      // `id` breaks the tie: two accounts created in the same millisecond would
      // otherwise be ordered arbitrarily, and a cursor into an arbitrary order
      // can skip or repeat a row.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One more than asked for, so "is there another page" is an observation
      // rather than a second count query.
      take: size + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: USER_DETAIL,
    });

    const { page, nextCursor } = paginate(rows, size);
    return { users: page.map(toAdminUser), nextCursor };
  }

  /** The trail, newest first. Same cursor shape as the directory. */
  async audit(take: number, cursor?: string): Promise<AdminAuditPage> {
    const size = pageSize(take);
    const rows = await prisma.adminAudit.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: size + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { actor: { select: { username: true } } },
    });

    const { page, nextCursor } = paginate(rows, size);
    return { entries: page.map(toAuditEntry), nextCursor };
  }

  async updateUser(actorId: string, userId: string, dto: AdminUserUpdateDto): Promise<AdminUser> {
    // An admin cannot lock themselves out; someone else has to do it.
    if (actorId === userId && (dto.role === 'USER' || dto.disabled === true)) {
      throw new BadRequestException({
        code: 'CANNOT_DEMOTE_SELF',
        message: 'Ask another administrator to change your own role or access',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No such user' });

    if (dto.role === 'USER' || dto.disabled === true) await this.assertNotLastAdmin(user.id);

    const disabledAt =
      dto.disabled === undefined ? undefined : dto.disabled ? new Date() : null;

    await prisma.user.update({
      where: { id: userId },
      data: { ...(dto.role ? { role: dto.role as GlobalRole } : {}), ...(disabledAt !== undefined ? { disabledAt } : {}) },
    });

    // Disabling has to end the sessions that already exist, not only block new
    // logins - an access token stays valid for its full lifetime otherwise.
    if (dto.disabled === true) {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    // One row per thing that actually changed, not one per request: "who made
    // this account an administrator" is the question the log is read for, and a
    // combined row would answer it only if you knew the previous state.
    if (dto.role !== undefined && dto.role !== user.role) {
      await record(actorId, 'user.role.changed', userId, `@${user.username}`, {
        from: user.role,
        to: dto.role,
      });
    }
    if (disabledAt !== undefined && (disabledAt === null) === (user.disabledAt !== null)) {
      await record(
        actorId,
        disabledAt ? 'user.disabled' : 'user.enabled',
        userId,
        `@${user.username}`,
      );
    }

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: USER_DETAIL,
    });
    return toAdminUser(updated);
  }

  async deleteUser(actorId: string, userId: string): Promise<void> {
    if (actorId === userId) {
      throw new BadRequestException({
        code: 'CANNOT_DELETE_SELF',
        message: 'Ask another administrator to delete your account',
      });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No such user' });

    await this.assertNotLastAdmin(userId);
    // Written before the delete, not after: `targetId` goes null with the
    // account, and the label is the only thing left saying who this was.
    await record(actorId, 'user.deleted', userId, `@${user.username}`, { email: user.email });
    // Cascades take the memberships, keys, identities and tokens with it.
    await prisma.user.delete({ where: { id: userId } });
  }

  async oauthProviders(): Promise<AdminOAuthProvider[]> {
    const rows = await prisma.oAuthProvider.findMany();

    return (Object.keys(PROVIDERS) as ProviderName[]).map((provider) => {
      const row = rows.find((item) => item.provider === provider);
      return {
        provider,
        label: PROVIDERS[provider].label,
        enabled: row?.enabled ?? false,
        clientId: row?.clientId ?? '',
        // The secret itself never leaves the server, in either direction.
        hasSecret: Boolean(row?.clientSecret),
        callbackUrl: callbackUrl(provider),
      };
    });
  }

  async updateOAuthProvider(
    actorId: string,
    provider: ProviderName,
    dto: AdminOAuthProviderDto,
  ): Promise<AdminOAuthProvider> {
    const existing = await prisma.oAuthProvider.findUnique({ where: { provider } });
    const clientId = dto.clientId.trim();
    // An omitted secret means "keep the stored one" - the panel cannot show it
    // back, so it must be able to save the rest of the form without it.
    const clientSecret = dto.clientSecret?.trim()
      ? sealSecret(dto.clientSecret.trim())
      : existing?.clientSecret;

    if (dto.enabled && (!clientId || !clientSecret)) {
      throw new BadRequestException({
        code: 'INCOMPLETE_PROVIDER',
        message: 'A client id and secret are required before enabling a provider',
      });
    }

    await prisma.oAuthProvider.upsert({
      where: { provider },
      create: { provider, enabled: dto.enabled, clientId, clientSecret: clientSecret ?? '' },
      update: { enabled: dto.enabled, clientId, clientSecret: clientSecret ?? '' },
    });

    // The secret itself is never in the log - only that one was replaced.
    await record(actorId, 'oauth.updated', provider, provider, {
      enabled: dto.enabled,
      secretReplaced: Boolean(dto.clientSecret?.trim()),
    });

    const all = await this.oauthProviders();
    return all.find((item) => item.provider === provider) as AdminOAuthProvider;
  }

  /** The platform must keep at least one enabled administrator. */
  private async assertNotLastAdmin(userId: string): Promise<void> {
    const others = await prisma.user.count({
      where: { role: 'ADMIN', disabledAt: null, id: { not: userId } },
    });
    if (others === 0) {
      throw new BadRequestException({
        code: 'LAST_ADMIN',
        message: 'This is the only administrator left; promote someone else first',
      });
    }
  }
}
