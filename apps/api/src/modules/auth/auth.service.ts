import { createHash, randomBytes } from 'node:crypto';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import type { LoginInput, RegisterInput } from './auth.schemas';

export const BCRYPT_COST = env.NODE_ENV === 'test' ? 4 : 12;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; name: string };
  memberships: { storeId: string; storeName: string; role: Role }[];
}

export interface NewSession {
  token: string;
  expiresAt: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createSession(userId: string): Promise<NewSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function registerOwner(
  input: RegisterInput,
): Promise<{ userId: string; session: NewSession }> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  try {
    const userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, passwordHash, name: input.name },
      });
      const store = await tx.store.create({ data: { name: input.storeName } });
      await tx.storeMembership.create({
        data: { userId: user.id, storeId: store.id, role: Role.OWNER },
      });
      return user.id;
    });
    return { userId, session: await createSession(userId) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'REGISTRATION_FAILED', 'Unable to register with these details');
    }
    throw err;
  }
}

export async function login(input: LoginInput): Promise<{ userId: string; session: NewSession }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.isActive) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  await prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  return { userId: user.id, session: await createSession(user.id) };
}

export async function logout(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function resolveSession(token: string): Promise<AuthContext | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { memberships: { include: { store: true } } } } },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date() || !session.user.isActive) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return {
    sessionId: session.id,
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    memberships: session.user.memberships.map((membership) => ({
      storeId: membership.storeId,
      storeName: membership.store.name,
      role: membership.role,
    })),
  };
}

export async function getAccount(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { memberships: { include: { store: true } } },
  });
  return {
    user: { id: user.id, email: user.email, name: user.name },
    memberships: user.memberships.map((membership) => ({
      storeId: membership.storeId,
      storeName: membership.store.name,
      role: membership.role,
    })),
  };
}
