import { z } from 'zod';
import { MAX_CSV_CHARS } from './importPlan';

export const importSchema = z
  .object({
    csv: z
      .string()
      .min(1, 'Choose a CSV file')
      .max(
        MAX_CSV_CHARS,
        `The file is too large (at most ${MAX_CSV_CHARS.toLocaleString('en-US')} characters)`,
      ),
    existing: z.enum(['skip', 'update']).default('skip'),
  })
  .strict();

export const exportQuery = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

export type ImportInput = z.infer<typeof importSchema>;
