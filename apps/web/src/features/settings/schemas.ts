import { z } from 'zod';
import type { StoreSettings, UpdateSettingsPayload } from '../../types/api';

const wholeNumber = (max: number, maxMessage: string) =>
  z
    .number({ invalid_type_error: 'Enter a whole number' })
    .int('Enter a whole number')
    .min(0, 'Cannot be negative')
    .max(max, maxMessage);

export const settingsFormSchema = z.object({
  storeName: z.string().trim().min(1, 'Enter your store name').max(100),
  businessCategory: z.string().trim().max(100),
  address: z.string().trim().max(300),
  phone: z.string().trim().max(40),
  contactEmail: z
    .string()
    .trim()
    .max(254)
    .refine(
      (value) => value === '' || z.string().email().safeParse(value).success,
      'Enter a valid email address',
    ),
  currency: z.string().min(3, 'Choose a currency'),
  timeZone: z.string().min(1, 'Choose a time zone'),
  taxName: z.string().trim().min(1, 'Enter a tax name').max(30),
  taxRatePercent: z
    .number({ invalid_type_error: 'Enter a number' })
    .min(0, 'Cannot be negative')
    .max(100, 'Cannot exceed 100')
    .refine((value) => Math.round(value * 100) / 100 === value, 'Use at most 2 decimal places'),
  taxInclusive: z.boolean(),
  receiptFooter: z.string().trim().max(300),
  allowNegativeStock: z.boolean(),
  defaultLowStockThreshold: wholeNumber(1_000_000, 'Too large'),
  defaultLeadTimeDays: wholeNumber(365, 'At most 365 days'),
});

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export function toFormValues(settings: StoreSettings): SettingsFormValues {
  return {
    storeName: settings.storeName,
    businessCategory: settings.businessCategory ?? '',
    address: settings.address ?? '',
    phone: settings.phone ?? '',
    contactEmail: settings.contactEmail ?? '',
    currency: settings.currency,
    timeZone: settings.timeZone,
    taxName: settings.taxName,
    taxRatePercent: Number(settings.taxRatePercent),
    taxInclusive: settings.taxInclusive,
    receiptFooter: settings.receiptFooter ?? '',
    allowNegativeStock: settings.allowNegativeStock,
    defaultLowStockThreshold: settings.defaultLowStockThreshold,
    defaultLeadTimeDays: settings.defaultLeadTimeDays,
  };
}

const orNull = (value: string): string | null => (value === '' ? null : value);

export function toPayload(values: SettingsFormValues): UpdateSettingsPayload {
  return {
    ...values,
    businessCategory: orNull(values.businessCategory),
    address: orNull(values.address),
    phone: orNull(values.phone),
    contactEmail: orNull(values.contactEmail),
    receiptFooter: orNull(values.receiptFooter),
  };
}
