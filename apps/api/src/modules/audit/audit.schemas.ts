import { z } from 'zod';
import { daysBetween, isValidDate } from '../reports/dateRange';

const dateStr = z.string().refine(isValidDate, 'Use a real date like 2026-11-01');

export const listAuditQuery = z
  .object({
    action: z
      .string()
      .regex(/^[a-z_]+(\.[a-z_]+)?$/, 'Use an action such as product.create, or a group such as product')
      .max(40)
      .optional(),
    actorUserId: z.string().uuid().optional(),
    resourceType: z.string().regex(/^[A-Za-z]+$/, 'Letters only').max(30).optional(),
    resourceId: z.string().regex(/^[0-9a-fA-F-]{1,64}$/, 'Use an id').optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['from'], message });
    if ((v.from === undefined) !== (v.to === undefined)) return issue('Provide both from and to, or neither');
    if (v.from === undefined || v.to === undefined) return;
    if (v.from > v.to) return issue('From must not be after to');
    if (daysBetween(v.from, v.to) + 1 > 731) return issue('The range can cover at most 731 days');
  });

export type ListAuditQuery = z.infer<typeof listAuditQuery>;
