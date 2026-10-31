import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { BCRYPT_COST } from '../auth/auth.service';
import type { CreateMemberInput } from './users.schemas';

export async function listMembers(storeId: string) {
  const memberships = await prisma.storeMembership.findMany({
    where: { storeId },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map((membership) => ({
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    isActive: membership.user.isActive,
  }));
}

export async function createMember(storeId: string, input: CreateMemberInput) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, passwordHash, name: input.name },
      });
      await tx.storeMembership.create({
        data: { userId: user.id, storeId, role: input.role },
      });
      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: input.role,
        isActive: user.isActive,
      };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'USER_CREATE_FAILED', 'Unable to create a user with these details');
    }
    throw err;
  }
}

export async function changeMemberRole(
  storeId: string,
  actorUserId: string,
  targetUserId: string,
  role: 'MANAGER' | 'CASHIER',
) {
  const membership = await prisma.storeMembership.findUnique({
    where: { userId_storeId: { userId: targetUserId, storeId } },
  });
  if (!membership) {
    throw new AppError(404, 'NOT_FOUND', 'User not found in this store');
  }
  if (targetUserId === actorUserId) {
    throw new AppError(403, 'CANNOT_CHANGE_OWN_ROLE', 'You cannot change your own role');
  }
  if (membership.role === Role.OWNER) {
    throw new AppError(403, 'CANNOT_CHANGE_OWNER', "An owner's role cannot be changed");
  }
  const updated = await prisma.storeMembership.update({
    where: { id: membership.id },
    data: { role },
  });
  return { userId: updated.userId, role: updated.role };
}
