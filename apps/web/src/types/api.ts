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

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Category {
  id: string;
  name: string;
  productCount: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  description: string | null;
  unit: string | null;
  categoryId: string | null;
  categoryName: string | null;
  costPrice: string | null;
  sellingPrice: string;
  stockQuantity: number;
  reorderThreshold: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductPayload {
  name: string;
  sku: string;
  barcode: string | null;
  description: string | null;
  unit: string | null;
  categoryId: string | null;
  costPrice: number;
  sellingPrice: number;
  reorderThreshold: number | null;
}

export type MovementType =
  'OPENING' | 'RECEIPT' | 'SALE' | 'RETURN' | 'ADJUSTMENT' | 'DAMAGED' | 'LOST' | 'RECONCILIATION';

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  type: MovementType;
  quantityChange: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  actorName: string;
  createdAt: string;
}

export interface MovementPayload {
  productId: string;
  type: 'OPENING' | 'ADJUSTMENT' | 'DAMAGED' | 'LOST' | 'RECONCILIATION';
  quantity: number;
  reason: string | null;
  idempotencyKey: string;
}

export interface LowStockResponse {
  total: number;
  items: { id: string; name: string; sku: string; stockQuantity: number; threshold: number }[];
}

export type UpdateSettingsPayload = Partial<
  Omit<StoreSettings, 'taxRatePercent' | 'onboardingCompletedAt' | 'updatedAt'>
> & { taxRatePercent?: number; completeOnboarding?: true };
