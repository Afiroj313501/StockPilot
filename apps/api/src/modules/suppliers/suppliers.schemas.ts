import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

const shape = {
  name: z.string().trim().min(1, 'Enter a name').max(150),
  contactName: optionalText(100),
  email: optionalText(254).refine(
    (v) => v === null || z.string().email().safeParse(v).success,
    'Enter a valid email address',
  ),
  phone: optionalText(40),
  address: optionalText(300),
  notes: optionalText(1000),
  leadTimeDays: z.number().int('Use a whole number').min(0).max(365).nullable(),
};

export const createSupplierSchema = z
  .object({
    name: shape.name,
    contactName: shape.contactName.optional(),
    email: shape.email.optional(),
    phone: shape.phone.optional(),
    address: shape.address.optional(),
    notes: shape.notes.optional(),
    leadTimeDays: shape.leadTimeDays.optional(),
  })
  .strict();

export const updateSupplierSchema = z
  .object({ ...shape, isActive: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const listSuppliersQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuery>;
