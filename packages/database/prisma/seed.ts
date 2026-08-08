/**
 * Development seed: one demo user with a server and two channels.
 * Run with `pnpm db:seed`. Idempotent - safe to run repeatedly.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@nexora/auth';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await hashPassword('nexora123');

  const user = await prisma.user.upsert({
    where: { email: 'demo@nexora.local' },
    update: {},
    create: {
      email: 'demo@nexora.local',
      username: 'demo',
      displayName: 'Demo User',
      passwordHash,
    },
  });

  const server = await prisma.server.upsert({
    where: { slug: 'demo-server' },
    update: {},
    create: {
      name: 'Demo Server',
      slug: 'demo-server',
      ownerId: user.id,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
  });

  for (const name of ['general', 'random']) {
    await prisma.channel.upsert({
      where: { serverId_name: { serverId: server.id, name } },
      update: {},
      create: { serverId: server.id, name, type: 'TEXT' },
    });
  }

  console.log('Seeded demo@nexora.local / nexora123');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
