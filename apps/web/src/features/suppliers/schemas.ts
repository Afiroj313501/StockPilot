import { z } from 'zod';
import type { Supplier, SupplierPayload } from '../../types/api';

export const supplierFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(150),
  contactName: z.string().trim().max(100),
  email: z
    .string()
    .trim()
    .max(254)
    .refine(
      (v) => v === '' || z.string().email().safeParse(v).success,
      'Enter a valid email address',
    ),
  phone: z.string().trim().max(40, 'Use at most 40 characters'),
  address: z.string().trim().max(300),
  notes: z.string().trim().max(1000),
  leadTimeDays: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (/^\d{1,3}$/.test(v) && Number(v) <= 365),
      'Use a whole number from 0 to 365, or leave blank',
    ),
});

export type SupplierFormValues = z.infer<typeof supplierFormSchema>;

export const emptySupplierForm: SupplierFormValues = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  notes: '',
  leadTimeDays: '',
};

export function toSupplierForm(s: Supplier): SupplierFormValues {
  return {
    name: s.name,
    contactName: s.contactName ?? '',
    email: s.email ?? '',
    phone: s.phone ?? '',
    address: s.address ?? '',
    notes: s.notes ?? '',
    leadTimeDays: s.leadTimeDays === null ? '' : String(s.leadTimeDays),
  };
}

const orNull = (v: string): string | null => (v === '' ? null : v);

export function toSupplierPayload(v: SupplierFormValues): SupplierPayload {
  return {
    name: v.name,
    contactName: orNull(v.contactName),
    email: orNull(v.email),
    phone: orNull(v.phone),
    address: orNull(v.address),
    notes: orNull(v.notes),
    leadTimeDays: v.leadTimeDays === '' ? null : Number(v.leadTimeDays),
  };
}
