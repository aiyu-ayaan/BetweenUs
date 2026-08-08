/** Admin panel business logic: the user directory and the OAuth configuration. */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sealSecret } from '@nexora/auth';
import { Prisma, prisma } from '@nexora/database';
import type {
  AdminOAuthProvider,
  AdminStatus,
  AdminUser,
  GlobalRole,
} from '@nexora/shared-types';
import { PROVIDERS, type ProviderName, callbackUrl } from './oauth-providers';
import type { AdminOAuthProviderDto, AdminUserUpdateDto } from './dto';

/** Page size cap, so a directory of any size cannot be pulled in one request. */
const MAX_TAKE = 100;

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

@Injectable()
export class AdminService {
  /** Public: the panel uses it to explain `pnpm admin:create` when nobody exists. */
  async status(): Promise<AdminStatus> {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', disabledAt: null } });
    return { hasAdmin: admins > 0 };
  }

  async users(query: string | undefined, take: number, skip: number): Promise<AdminUser[]> {
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

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), MAX_TAKE),
      skip: Math.max(skip, 0),
      include: USER_DETAIL,
    });

    return users.map(toAdminUser);
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
