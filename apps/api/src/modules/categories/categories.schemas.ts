import { z } from 'zod';

export const categoryBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(100),
  })
  .strict();

export type CategoryBody = z.infer<typeof categoryBodySchema>;
