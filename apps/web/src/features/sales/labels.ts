import type { PaymentMethod } from '../../types/api';

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card (recorded manually)',
  MOBILE: 'Mobile wallet (recorded manually)',
  OTHER: 'Other (recorded manually)',
};

export interface CartLine {
  productId: string;
  name: string;
  sku: string;
  unitPrice: string; // shown in the cart; the server uses the current price at checkout
  stock: number;
  quantity: number;
}
