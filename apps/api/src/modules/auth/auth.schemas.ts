import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password: z.string().min(10, 'Use at least 10 characters').max(72),
  storeName: z.string().trim().min(1).max(100),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
