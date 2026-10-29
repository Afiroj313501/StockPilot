import { prisma } from '../db/prisma';

export async function resetDb(): Promise<void> {
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('Refusing to reset a database whose name does not end in _test');
  }
  await prisma.session.deleteMany();
  await prisma.storeMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.store.deleteMany();
}
