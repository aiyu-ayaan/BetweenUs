/** Admin panel business logic: the user directory and the OAuth configuration. */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sealSecret } from '@betweenus/auth';
import { envOr } from '@betweenus/config';
import { Prisma, prisma } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { createLogger, type LogLevel } from '@betweenus/logger';
import type {
  AdminAuditEntry,
  AdminAuditPage,
  AdminOAuthProvider,
  AdminSmtpSettings,
  AdminSmtpTestResult,
  AdminStatus,
  AdminUser,
  AdminUserPage,
  GlobalRole,
} from '@betweenus/shared-types';
import { MailService } from '../mail/mail.service';
import { toVisibility } from '../auth/auth.service';
import { PROVIDERS, type ProviderName, callbackUrl } from './oauth-providers';
import type { AdminOAuthProviderDto, AdminSmtpDto, AdminUserUpdateDto } from './dto';

const logger = createLogger('auth-service', envOr('LOG_LEVEL', 'info') as LogLevel);

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
  // The fallback for "last seen": the newest live session, for an account that
  // predates the column presence-service now writes. See `toAdminUser`.
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
    about: user.about,
    lastSeenVisibility: toVisibility(user.lastSeenVisibility),
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    messageTtlSeconds: user.messageTtlSeconds,
    createdAt: user.createdAt.toISOString(),
    disabledAt: user.disabledAt?.toISOString() ?? null,
    passwordResetUntil: user.passwordResetUntil?.toISOString() ?? null,
    identities: user.identities.map((identity) => identity.provider),
    serverCount: user._count.memberships,
    // The real value now that presence-service keeps one, and the newest live
    // session only for an account that has not connected since the column
    // existed - which is where this number used to come from for everybody, and
    // was only ever "when they last signed in".
    //
    // `lastSeenVisibility` is deliberately not applied here. It governs what one
    // account may learn about another over `/ws/presence`; this is an operator
    // reading their own deployment's user table, which they can do with `psql`
    // whatever this code does. Filtering it would be theatre, and the panel
    // shows the setting itself in the same row so it is not a hidden one.
    lastSeenAt:
      user.lastSeenAt?.toISOString() ?? user.refreshTokens[0]?.createdAt.toISOString() ?? null,
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

/**
 * How long an administrator's reset grant stays open.
 *
 * It is a window and not a flag on purpose. "This account may set a new
 * password without knowing the old one" is the strongest thing the panel can
 * say about somebody, and a flag left on by an administrator who got
 * distracted is that sentence standing forever. A day is long enough to tell a
 * colleague over a desk or a phone call, and it expires on its own if nobody
 * does.
 */
const RESET_WINDOW_HOURS = Number(envOr('PASSWORD_RESET_WINDOW_HOURS', '24')) || 24;

@Injectable()
export class AdminService {
  constructor(
    private readonly mail: MailService,
    private readonly events: EventBus,
  ) {}

  /**
   * Tells the gateways to drop an account's open sockets.
   *
   * Revoking refresh tokens stops a session being renewed; it does nothing to a
   * socket, which is authenticated once at the handshake and then trusted until
   * it disconnects. Disabling an account without this left every chat, presence,
   * call and remote socket it already had delivering as if nothing had happened.
   *
   * Swallowed on failure: an unreachable Redis must not turn "this account is
   * disabled" into a 500 that leaves it enabled. The refresh tokens are already
   * dead in Postgres, which is the durable half.
   */
  private async revokeSockets(
    userId: string,
    reason: 'disabled' | 'deleted',
  ): Promise<void> {
    try {
      await this.events.publish(EVENTS.SESSION_REVOKED, {
        userId,
        notBefore: Math.floor(Date.now() / 1000),
        reason,
      });
    } catch (error) {
      logger.warn('Could not publish a session revocation', {
        userId,
        reason,
        error: String(error),
      });
    }
  }

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

    // A window rather than a flag - see RESET_WINDOW_HOURS. False closes one
    // that is open; it does not reach back and revoke a token already spent.
    const passwordResetUntil =
      dto.passwordReset === undefined
        ? undefined
        : dto.passwordReset
          ? new Date(Date.now() + RESET_WINDOW_HOURS * 60 * 60 * 1000)
          : null;

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.role ? { role: dto.role as GlobalRole } : {}),
        ...(disabledAt !== undefined ? { disabledAt } : {}),
        ...(passwordResetUntil !== undefined ? { passwordResetUntil } : {}),
      },
    });

    // Disabling has to end the sessions that already exist, not only block new
    // logins - an access token stays valid for its full lifetime otherwise.
    if (dto.disabled === true) {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // And the sockets that are already open, which the row above cannot
      // reach. Without this, disabling somebody mid-call left them in the call.
      await this.revokeSockets(userId, 'disabled');
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
    // Always logged, both directions. Handing somebody a way past a password is
    // the entry an incident is reconstructed from, so it is written even when
    // the window was already open and this only extended it.
    if (passwordResetUntil !== undefined) {
      await record(
        actorId,
        passwordResetUntil ? 'user.password_reset.opened' : 'user.password_reset.closed',
        userId,
        `@${user.username}`,
        passwordResetUntil ? { until: passwordResetUntil.toISOString() } : undefined,
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
    // The sockets do not cascade. A deleted account holding an open socket is
    // worse than a disabled one holding it: every row the gateway reads for it
    // is gone, so what it delivers is whatever a missing row happens to mean.
    await this.revokeSockets(userId, 'deleted');
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

  /** The mail server as the panel shows it: everything but the password. */
  async smtpSettings(): Promise<AdminSmtpSettings> {
    const row = await this.mail.settings();
    return {
      enabled: row?.enabled ?? false,
      host: row?.host ?? '',
      port: row?.port ?? 587,
      secure: row?.secure ?? false,
      username: row?.username ?? '',
      // The password itself never leaves the server, in either direction.
      hasPassword: Boolean(row?.password),
      fromAddress: row?.fromAddress ?? '',
      fromName: row?.fromName ?? 'BetweenUs',
    };
  }

  async updateSmtp(actorId: string, dto: AdminSmtpDto): Promise<AdminSmtpSettings> {
    const existing = await this.mail.settings();
    const host = dto.host.trim();
    const fromAddress = dto.fromAddress.trim();
    // An omitted password means "keep the stored one" - the panel cannot show
    // it back, so it must be able to save the rest of the form without it.
    const password = dto.password?.trim()
      ? sealSecret(dto.password.trim())
      : (existing?.password ?? '');

    // Enabling with either of these blank is a configuration that fails at the
    // first send, silently, hours later. Refused here instead.
    if (dto.enabled && (!host || !fromAddress)) {
      throw new BadRequestException({
        code: 'INCOMPLETE_SMTP',
        message: 'A host and a from address are required before enabling mail',
      });
    }

    const data = {
      enabled: dto.enabled,
      host,
      port: dto.port,
      secure: dto.secure,
      username: dto.username.trim(),
      password,
      fromAddress,
      fromName: dto.fromName.trim() || 'BetweenUs',
    };
    await prisma.smtpSetting.upsert({
      where: { id: 'smtp' },
      create: { id: 'smtp', ...data },
      update: data,
    });

    // The password is never in the log - only that one was replaced.
    await record(actorId, 'smtp.updated', 'smtp', 'smtp', {
      enabled: dto.enabled,
      host,
      passwordReplaced: Boolean(dto.password?.trim()),
    });
    return this.smtpSettings();
  }

  /**
   * Sends one message to prove the settings work.
   *
   * The transport's own refusal is handed back verbatim rather than flattened
   * into "failed": "535 authentication failed" and "getaddrinfo ENOTFOUND" are
   * two different afternoons, and the panel is the only place anybody would
   * ever read the difference.
   */
  async testSmtp(actorId: string, to?: string): Promise<AdminSmtpTestResult> {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { email: true } });
    const recipient = to?.trim() || actor?.email;
    if (!recipient) {
      throw new BadRequestException({ code: 'NO_RECIPIENT', message: 'No address to send to' });
    }

    const result = await this.mail.send({
      to: recipient,
      subject: 'BetweenUs test message',
      text: 'This is a test message from the BetweenUs admin panel. Mail is configured correctly.',
    });
    await record(actorId, 'smtp.tested', 'smtp', 'smtp', { ok: result.ok });
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'Send failed' };
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
