export type Role = 'OWNER' | 'MANAGER' | 'CASHIER';

export interface Membership {
  storeId: string;
  storeName: string;
  role: Role;
}

export interface Account {
  user: { id: string; email: string; name: string };
  memberships: Membership[];
}

export interface StoreSettings {
  storeName: string;
  businessCategory: string | null;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
  currency: string;
  timeZone: string;
  taxName: string;
  taxRatePercent: string;
  taxInclusive: boolean;
  receiptFooter: string | null;
  allowNegativeStock: boolean;
  defaultLowStockThreshold: number;
  defaultLeadTimeDays: number;
  onboardingCompletedAt: string | null;
  updatedAt: string;
}

export type UpdateSettingsPayload = Partial<
  Omit<StoreSettings, 'taxRatePercent' | 'onboardingCompletedAt' | 'updatedAt'>
> & { taxRatePercent?: number; completeOnboarding?: true };
