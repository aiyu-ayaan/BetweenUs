/**
 * Admin authorisation.
 *
 * The access token says who you are, never what you may do - roles change and
 * a 15-minute token would carry a stale one - so the role is read from the
 * database on every admin request. Admin traffic is rare; a lookup is cheap
 * next to handing someone the panel after a demotion.
 *
 * That lookup has a deadline, and the reason is the health page. Every admin
 * route sits behind this guard, the health page included - so a deployment whose
 * database has stopped answering could not be asked about it. The request got as
 * far as here and waited: no red card, no error, a spinner for as long as anyone
 * cared to watch. The one screen whose entire purpose is to say "Postgres is not
 * answering" was the screen that could not be reached while it was true.
 *
 * There is no way to authorise an administrator without reading the database, so
 * the deadline does not grant anything - it answers. 503 with a code the panel
 * can recognise beats a request that never returns, because "the database did
 * not answer in two and a half seconds" is itself the diagnosis somebody opened
 * the page for.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { prisma } from '@betweenus/database';
import type { AuthenticatedUser } from '@betweenus/auth';

/**
 * The same deadline the health probes use. Deliberately the same: a database
 * this guard calls too slow must be one the page next to it also calls too slow,
 * or the two disagree about the deployment in front of them.
 */
const LOOKUP_TIMEOUT_MS = 2_500;

/** Rejects with `onTimeout` if `work` has not settled in time. */
async function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms);
      }),
    ]);
  } finally {
    // Cleared either way. An uncleared timer holds the event loop open for its
    // full duration on every admin request, which on a healthy deployment is
    // most of them.
    if (timer) clearTimeout(timer);
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not authenticated' });

    const user = await withDeadline(
      prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, disabledAt: true, mustChangePassword: true },
      }),
      LOOKUP_TIMEOUT_MS,
      () =>
        new ServiceUnavailableException({
          code: 'DATABASE_UNAVAILABLE',
          message: 'The database did not answer, so this request could not be authorised',
        }),
    );

    if (!user || user.role !== 'ADMIN' || user.disabledAt !== null) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Administrator access required' });
    }

    // An account still on its generated password may do exactly one thing:
    // change it. Everything else waits until it has.
    if (user.mustChangePassword) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Choose a new password before using the admin panel',
      });
    }

    return true;
  }
}
