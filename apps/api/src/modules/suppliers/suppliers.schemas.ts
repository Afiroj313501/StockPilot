import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

export const supplierSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(200),
    phone: optionalText(40).optional(),
    email: optionalText(320).optional(),
    address: optionalText(500).optional(),
    notes: optionalText(1000).optional(),
  })
  .strict();
export const supplierUpdateSchema = supplierSchema
  .extend({ isActive: z.boolean().optional() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
export type SupplierInput = z.infer<typeof supplierSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
