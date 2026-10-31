import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(72),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100),
  storeName: z.string().trim().min(1, 'Enter your store name').max(100),
  email,
  password: z.string().min(10, 'Use at least 10 characters').max(72, 'Use at most 72 characters'),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
