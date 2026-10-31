import type { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/httpError';
import { getStore } from './store.middleware';

const RANK: Record<Role, number> = { CASHIER: 1, MANAGER: 2, OWNER: 3 };

export function hasRole(actual: Role, minimum: Role): boolean {
  return RANK[actual] >= RANK[minimum];
}

export function requireRole(minimum: Role) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!hasRole(getStore(res).role, minimum)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to do this'));
      return;
    }
    next();
  };
}
