import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { generateTemporaryPassword } from '../../utils/password';
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
    mustChangePassword: membership.user.mustChangePassword,
  }));
}

export async function createMember(storeId: string, input: CreateMemberInput) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          name: input.name,
          mustChangePassword: input.requirePasswordChange ?? false,
        },
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
  if (!membership) throw new AppError(404, 'NOT_FOUND', 'User not found in this store');
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

async function findMember(storeId: string, userId: string) {
  const membership = await prisma.storeMembership.findUnique({
    where: { userId_storeId: { userId, storeId } },
    include: { user: true },
  });
  if (!membership) throw new AppError(404, 'NOT_FOUND', 'User not found in this store');
  return membership;
}

export async function setMemberActive(
  storeId: string,
  actorUserId: string,
  targetUserId: string,
  isActive: boolean,
) {
  const membership = await findMember(storeId, targetUserId);
  if (targetUserId === actorUserId) {
    throw new AppError(
      403,
      'CANNOT_CHANGE_OWN_STATUS',
      'You cannot deactivate or reactivate your own account',
    );
  }
  if (membership.role === Role.OWNER) {
    throw new AppError(403, 'CANNOT_CHANGE_OWNER', 'An owner account cannot be deactivated');
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: targetUserId }, data: { isActive } }),
    ...(isActive ? [] : [prisma.session.deleteMany({ where: { userId: targetUserId } })]),
  ]);
  return { userId: targetUserId, name: membership.user.name, isActive };
}

export async function resetMemberPassword(
  storeId: string,
  actorUserId: string,
  targetUserId: string,
) {
  const membership = await findMember(storeId, targetUserId);
  if (targetUserId === actorUserId) {
    throw new AppError(
      403,
      'CANNOT_RESET_OWN_PASSWORD',
      'Use "Change password" on your account page instead',
    );
  }
  if (membership.role === Role.OWNER) {
    throw new AppError(403, 'CANNOT_CHANGE_OWNER', "An owner's password cannot be reset here");
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetUserId },
      data: { passwordHash, mustChangePassword: true },
    }),
    prisma.session.deleteMany({ where: { userId: targetUserId } }),
  ]);
  return { userId: targetUserId, name: membership.user.name, temporaryPassword };
}
