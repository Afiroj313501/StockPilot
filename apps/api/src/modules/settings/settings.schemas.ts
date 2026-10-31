import { z } from 'zod';
import { canonicalTimeZone, isValidCurrency } from '../../utils/locale';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

export const updateSettingsSchema = z
  .object({
    storeName: z.string().trim().min(1).max(100),
    businessCategory: optionalText(100),
    address: optionalText(300),
    phone: optionalText(40),
    contactEmail: optionalText(254).refine(
      (value) => value === null || z.string().email().safeParse(value).success,
      'Enter a valid email address',
    ),
    currency: z.string().trim().toUpperCase().refine(isValidCurrency, 'Unknown currency code'),
    timeZone: z
      .string()
      .trim()
      .max(64)
      .refine((value) => canonicalTimeZone(value) !== null, 'Unknown time zone')
      .transform((value) => canonicalTimeZone(value) as string),
    taxName: z.string().trim().min(1).max(30),
    taxRatePercent: z
      .number()
      .min(0)
      .max(100)
      .refine((value) => Math.round(value * 100) / 100 === value, 'Use at most 2 decimal places'),
    taxInclusive: z.boolean(),
    receiptFooter: optionalText(300),
    allowNegativeStock: z.boolean(),
    defaultLowStockThreshold: z.number().int().min(0).max(1_000_000),
    defaultLeadTimeDays: z.number().int().min(0).max(365),
    completeOnboarding: z.literal(true),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field');

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
