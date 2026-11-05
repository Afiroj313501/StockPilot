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

export interface AiEvidence {
  tool: string;
  label: string;
  params: Record<string, unknown>;
  period?: { from: string; to: string; timeZone: string };
  metrics: Record<string, string | number>;
}

export interface AiAnswer {
  status: 'ANSWERED' | 'UNSUPPORTED' | 'UNAVAILABLE';
  mode: 'AI' | 'BUILT_IN';
  answer: string | null;
  evidence: AiEvidence[];
  notice: string | null;
  supportedQuestions: string[];
}

export interface AiStatus {
  mode: 'AI' | 'BUILT_IN';
  reason: 'ENABLED' | 'DISABLED' | 'NOT_CONFIGURED';
  providerName: string | null;
  supportedQuestions: string[];
  privacy: string;
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

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  leadTimeDays: number | null;
  isActive: boolean;
  orderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierPayload {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  leadTimeDays: number | null;
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

export type PurchaseStatus =
  'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseSummary {
  id: string;
  number: number;
  reference: string;
  status: PurchaseStatus;
  supplierId: string;
  supplierName: string;
  itemCount: number;
  total: string;
  expectedDate: string | null;
  createdAt: string;
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  productSku: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityRemaining: number;
  unitCost: string;
  lineTotal: string;
}

export interface PurchaseReceipt {
  id: string;
  receivedAt: string;
  receivedByName: string;
  note: string | null;
  items: {
    productId: string;
    productName: string;
    productSku: string;
    quantity: number;
    unitCost: string;
    lineTotal: string;
  }[];
}

export interface PurchaseDetail extends PurchaseSummary {
  notes: string | null;
  createdByName: string;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: PurchaseItem[];
  receipts: PurchaseReceipt[];
}

export interface PurchasePayload {
  supplierId: string;
  notes: string | null;
  expectedDate: string | null;
  items: { productId: string; quantityOrdered: number; unitCost: number }[];
}

export interface ReceivePayload {
  idempotencyKey: string;
  note: string | null;
  items: { productId: string; quantity: number }[];
}

export type Confidence = 'INSUFFICIENT' | 'LOW' | 'MEDIUM' | 'HIGH';
export type Urgency = 'CRITICAL' | 'HIGH' | 'NONE';

export interface ReorderParams {
  windowDays: number;
  safetyDays: number;
  coverageDays: number;
}

export interface ReorderItem {
  productId: string;
  name: string;
  sku: string;
  unit: string | null;
  status: 'REORDER' | 'OK' | 'INSUFFICIENT_DATA';
  confidence: Confidence;
  urgency: Urgency;
  lowStock: boolean;
  currentStock: number;
  incomingStock: number;
  pendingOrderQuantity: number;
  position: number;
  supplier: { id: string; name: string; isActive: boolean } | null;
  leadTimeDays: number;
  leadTimeSource: 'SUPPLIER' | 'STORE_DEFAULT';
  safetyDays: number;
  coverageDays: number;
  inputs: {
    windowStart: string;
    windowEnd: string;
    observedDays: number;
    unitsSold: number;
    unitsReturned: number;
    eligibleUnits: number;
    transactions: number;
    lowStockThreshold: number;
  };
  averageDailyDemand: string;
  leadTimeDemand: number;
  safetyStock: number;
  coverageStock: number;
  reorderPoint: number;
  orderUpToLevel: number;
  daysOfCover: string | null;
  recommendedQuantity: number | null;
  unitCost: string;
  estimatedCost: string | null;
  reviewState: {
    status: 'DISMISSED' | 'REVIEWED' | 'ORDERED';
    createdAt: string;
    purchaseOrderId: string | null;
  } | null;
  steps: string[];
}

export interface ReorderResponse {
  today: string;
  timeZone: string;
  params: ReorderParams;
  counts: { evaluated: number; reorder: number; insufficientLowStock: number; handled: number };
  items: ReorderItem[];
}

export interface CreateDraftPayload {
  idempotencyKey: string;
  quantity: number;
  supplierId: string;
  params: ReorderParams;
}

export type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE' | 'OTHER';

export interface SaleLine {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: string;
  lineSubtotal: string;
  discountShare: string;
  taxShare: string;
  lineTotal: string;
}

export interface SalePreview {
  currency: string;
  taxName: string;
  taxRatePercent: string;
  taxInclusive: boolean;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  lines: SaleLine[];
}

export interface SaleDetail {
  id: string;
  number: number;
  reference: string;
  status: 'COMPLETED' | 'VOIDED';
  createdAt: string;
  cashierName: string;
  customerName: string | null;
  currency: string;
  taxName: string;
  taxRatePercent: string;
  taxInclusive: boolean;
  subtotal: string;
  discountType: 'PERCENT' | 'AMOUNT' | null;
  discountValue: string | null;
  discountTotal: string;
  taxTotal: string;
  total: string;
  items: SaleLine[];
  payments: { method: PaymentMethod; amount: string; tendered: string; change: string }[];
}

export interface SaleSummary {
  id: string;
  number: number;
  reference: string;
  status: 'COMPLETED' | 'VOIDED';
  createdAt: string;
  cashierName: string;
  unitCount: number;
  returnStatus: ReturnStatus;
  total: string;
  paymentMethod: PaymentMethod | null;
}

export interface CartDiscount {
  type: 'PERCENT' | 'AMOUNT';
  value: number;
}

export interface CheckoutPayload {
  idempotencyKey: string;
  items: { productId: string; quantity: number }[];
  discount: CartDiscount | null;
  customerName: string | null;
  payment: { method: PaymentMethod; amountTendered: number };
  expectedTotal: number;
}

export type ReturnReason = 'CHANGED_MIND' | 'DAMAGED' | 'WRONG_ITEM' | 'OTHER';
export type ReturnStatus = 'NONE' | 'PARTIAL' | 'FULL';

export interface SaleReturnDetail {
  id: string;
  number: number;
  reference: string;
  saleId: string;
  saleReference: string;
  createdAt: string;
  processedByName: string;
  note: string | null;
  refundMethod: PaymentMethod;
  refundTotal: string;
  taxRefundTotal: string;
  items: {
    productId: string;
    productName: string;
    productSku: string;
    quantity: number;
    reason: ReturnReason;
    restock: boolean;
    refundAmount: string;
    taxRefund: string;
  }[];
}

export interface ReturnSummary {
  id: string;
  number: number;
  reference: string;
  saleId: string;
  saleReference: string;
  createdAt: string;
  processedByName: string;
  unitCount: number;
  refundTotal: string;
  refundMethod: PaymentMethod;
}

export interface SaleReturnable {
  saleId: string;
  saleReference: string;
  saleStatus: 'COMPLETED' | 'VOIDED';
  currency: string;
  refundMethod: PaymentMethod;
  returnStatus: ReturnStatus;
  lines: {
    productId: string;
    productName: string;
    productSku: string;
    quantitySold: number;
    quantityReturned: number;
    quantityReturnable: number;
    unitPrice: string;
    lineTotal: string;
  }[];
  returns: SaleReturnDetail[];
}

export interface ReturnPreview {
  currency: string;
  refundMethod: PaymentMethod;
  refundTotal: string;
  taxRefundTotal: string;
  lines: {
    productId: string;
    productName: string;
    quantity: number;
    refundAmount: string;
    taxRefund: string;
  }[];
}

export interface CreateReturnPayload {
  saleId: string;
  idempotencyKey: string;
  note: string | null;
  items: { productId: string; quantity: number; restock: boolean; reason: ReturnReason }[];
}

export interface ReportPeriod {
  from: string;
  to: string;
  timeZone: string;
  today: string;
  group?: 'day' | 'week' | 'month';
}

export interface ReportMetrics {
  salesCount: number;
  returnsCount: number;
  grossSales: string;
  discounts: string;
  taxCollected: string;
  salesTotal: string;
  refunds: string;
  taxRefunded: string;
  netSales: string;
  cogs: string;
  grossProfit: string;
}

export interface SalesSummary {
  period: ReportPeriod;
  totals: ReportMetrics;
  series: (ReportMetrics & { bucket: string })[];
  warnings: { zeroCostLines: number };
}

export interface ProductReportRow {
  productId: string;
  name: string;
  sku: string;
  unitsSold: number;
  unitsReturned: number;
  netUnits: number;
  netRevenue: string;
  cogs: string;
  grossProfit: string;
}

export interface CategoryReportRow {
  categoryId: string | null;
  name: string;
  unitsSold: number;
  unitsReturned: number;
  netUnits: number;
  netRevenue: string;
  cogs: string;
  grossProfit: string;
}

export interface InventoryTotals {
  units: number;
  productsWithStock: number;
  costValue: string;
  retailValue: string;
}

export interface InventoryReport {
  totals: InventoryTotals;
  categories: {
    categoryId: string | null;
    name: string;
    units: number;
    costValue: string;
    retailValue: string;
  }[];
  lowStock: LowStockResponse;
}

export interface Dashboard {
  period: ReportPeriod;
  summary: SalesSummary;
  topProducts: ProductReportRow[];
  categories: CategoryReportRow[];
  inventory: InventoryTotals;
  lowStock: LowStockResponse;
  pendingPurchases: { awaitingApproval: number; awaitingDelivery: number };
  recentSales: SaleSummary[];
}
