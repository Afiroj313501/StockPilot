import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../../utils/logger';
import type { AuthContext } from '../auth/auth.service';
import type { StoreContext } from '../auth/store.middleware';
import { recordAudit, type AuditWriter } from './audit.service';
import { describeRequest } from './rules';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function parseJson(chunk: unknown, res: Response): Record<string, unknown> | null {
  const type = String(res.getHeader('Content-Type') ?? '');
  if (!type.includes('json') || chunk === undefined || chunk === null) return null;
  try {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function capture(
  req: Request,
  res: Response,
  chunk: unknown,
  write: AuditWriter,
): Promise<void> {
  try {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    if (res.getHeader('Idempotent-Replayed')) return;
    const auth = res.locals.auth as AuthContext | undefined;
    const store = res.locals.store as StoreContext | undefined;
    if (!auth || !store) return;

    const description = describeRequest({
      method: req.method,
      path: req.originalUrl.split('?')[0] ?? '',
      query: req.query as Record<string, unknown>,
      body: (req.body ?? {}) as Record<string, unknown>,
      response: parseJson(chunk, res),
    });
    if (!description) return;

    await write({
      storeId: store.storeId,
      actorUserId: auth.user.id,
      actorName: auth.user.name,
      actorRole: store.role,
      ...description,
      requestId: res.locals.requestId as string | undefined,
    });
  } catch (err) {
    logger.error({ err, requestId: res.locals.requestId }, 'Audit log write failed');
  }
}

export function createAuditTrail(write: AuditWriter = recordAudit): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    const audited =
      MUTATING.has(method) || (method === 'GET' && req.path.startsWith('/api/v1/reports/export/'));
    if (!audited) return next();

    const originalEnd = res.end.bind(res) as (...args: unknown[]) => Response;
    let handled = false;
    (res as unknown as { end: (...args: unknown[]) => Response }).end = (...args: unknown[]) => {
      if (handled) return originalEnd(...args);
      handled = true;
      const finish = () => originalEnd(...args);
      void capture(req, res, args[0], write).then(finish, finish);
      return res;
    };
    next();
  };
}
