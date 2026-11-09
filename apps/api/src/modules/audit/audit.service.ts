import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { logger } from '../../utils/logger';
import { rangeToUtc } from '../reports/dateRange';
import { ACTION_LABEL } from './actions';
import type { ListAuditQuery } from './audit.schemas';
import { sanitizeMetadata } from './sanitize';

export interface AuditEntry {
  storeId: string;
  actorUserId: string;
  actorName: string;
  actorRole: Role;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | undefined;
  requestId?: string | undefined;
}

export type AuditWriter = (entry: AuditEntry) => Promise<void>;

const clip = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);

export const recordAudit: AuditWriter = async (e) => {
  const metadata = e.metadata ? sanitizeMetadata(e.metadata) : undefined;
  await prisma.auditLog.create({
    data: {
      storeId: e.storeId,
      actorUserId: e.actorUserId,
      actorName: clip(e.actorName, 100),
      actorRole: e.actorRole,
      action: clip(e.action, 60),
      resourceType: e.resourceType ?? null,
      resourceId: e.resourceId ? clip(e.resourceId, 64) : null,
      summary: clip(e.summary, 300),
      ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonObject } : {}),
      requestId: e.requestId ?? null,
    },
  });
};

export async function recordAuthEvent(input: {
  userId: string;
  action: 'auth.register' | 'auth.login' | 'auth.logout';
  summary: string;
  requestId?: string | undefined;
}): Promise<void> {
  try {
    const memberships = await prisma.storeMembership.findMany({
      where: { userId: input.userId },
      include: { user: { select: { name: true } } },
    });
    for (const m of memberships) {
      await recordAudit({
        storeId: m.storeId,
        actorUserId: input.userId,
        actorName: m.user.name,
        actorRole: m.role,
        action: input.action,
        resourceType: 'User',
        resourceId: input.userId,
        summary: input.summary,
        requestId: input.requestId,
      });
    }
  } catch (err) {
    logger.error({ err, action: input.action }, 'Audit log write failed (auth event)');
  }
}

export async function recordFailedLogin(email: string, requestId?: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
    if (!user || user.memberships.length === 0) {
      logger.warn({ event: 'auth.login_failed_unknown_account', requestId }, 'Failed sign-in for an unknown account');
      return;
    }
    for (const m of user.memberships) {
      await recordAudit({
        storeId: m.storeId,
        actorUserId: user.id,
        actorName: user.name,
        actorRole: m.role,
        action: 'auth.login_failed',
        resourceType: 'User',
        resourceId: user.id,
        summary: 'Failed sign-in attempt',
        requestId,
      });
    }
  } catch (err) {
    logger.error({ err }, 'Audit log write failed (failed sign-in)');
  }
}

export async function listAuditLogs(storeId: string, q: ListAuditQuery) {
  const where: Prisma.AuditLogWhereInput = { storeId };
  if (q.action) where.action = q.action.includes('.') ? q.action : { startsWith: `${q.action}.` };
  if (q.actorUserId) where.actorUserId = q.actorUserId;
  if (q.resourceType) where.resourceType = q.resourceType;
  if (q.resourceId) where.resourceId = q.resourceId;

  if (q.from && q.to) {
    const setting = await prisma.storeSetting.findUnique({ where: { storeId }, select: { timeZone: true } });
    const { start, end } = rangeToUtc(q.from, q.to, setting?.timeZone ?? 'UTC');
    where.createdAt = { gte: start, lt: end };
  }

  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actorUserId: r.actorUserId,
      actorName: r.actorName,
      actorRole: r.actorRole,
      action: r.action,
      label: ACTION_LABEL.get(r.action) ?? r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      summary: r.summary,
      metadata: r.metadata,
      requestId: r.requestId,
    })),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize),
  };
}
