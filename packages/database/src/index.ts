/**
 * Prisma client singleton. Services import `prisma` rather than constructing
 * their own client so a service process holds exactly one connection pool.
 */
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '@nexora/config';

loadEnv();

const globalForPrisma = globalThis as unknown as { nexoraPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.nexoraPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.nexoraPrisma = prisma;
}

/** Used by `/health` to prove the database is reachable. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export * from '@prisma/client';
