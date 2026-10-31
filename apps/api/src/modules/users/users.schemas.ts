import { z } from 'zod';

const assignableRole = z.enum(['MANAGER', 'CASHIER']);

export const createMemberSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'Use at least 10 characters').max(72),
  role: assignableRole,
});

export const changeRoleSchema = z.object({ role: assignableRole });
export const userIdParam = z.string().uuid();

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
