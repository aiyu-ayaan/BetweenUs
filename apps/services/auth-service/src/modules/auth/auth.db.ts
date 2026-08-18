/**
 * The slice of Prisma `AuthService` uses, behind an injection token.
 *
 * The token exists so the self-check can hand the service a fake instead of a
 * live Postgres; production still gets the same `prisma` singleton every other
 * service holds.
 */
import { prisma } from '@betweenus/database';

export const AuthDatabase = 'AUTH_DATABASE';

export type AuthDb = Pick<typeof prisma, 'user' | 'refreshToken'>;

export const authDatabaseProvider = {
  provide: AuthDatabase,
  useValue: prisma as AuthDb,
};
