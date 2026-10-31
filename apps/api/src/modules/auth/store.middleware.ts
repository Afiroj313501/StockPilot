import type { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/httpError';
import { getAuth } from './auth.middleware';

export interface StoreContext {
  storeId: string;
  storeName: string;
  role: Role;
}

export function requireStore(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(res);
  const requested = req.get('x-store-id');
  const membership = requested
    ? auth.memberships.find((item) => item.storeId === requested)
    : auth.memberships.length === 1
      ? auth.memberships[0]
      : undefined;

  if (!membership) {
    next(new AppError(403, 'STORE_ACCESS_DENIED', 'You do not have access to this store'));
    return;
  }

  res.locals.store = {
    storeId: membership.storeId,
    storeName: membership.storeName,
    role: membership.role,
  } satisfies StoreContext;
  next();
}

export function getStore(res: Response): StoreContext {
  return res.locals.store as StoreContext;
}
