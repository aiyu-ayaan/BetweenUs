/**
 * Admin authorisation.
 *
 * The access token says who you are, never what you may do - roles change and
 * a 15-minute token would carry a stale one - so the role is read from the
 * database on every admin request. Admin traffic is rare; a lookup is cheap
 * next to handing someone the panel after a demotion.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { prisma } from '@nexora/database';
import type { AuthenticatedUser } from '@nexora/auth';

@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not authenticated' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, disabledAt: true, mustChangePassword: true },
    });

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
