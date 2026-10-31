import type { MovementType } from '../../types/api';
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  OPENING: 'Opening stock',
  RECEIPT: 'Stock received',
  SALE: 'Sale',
  RETURN: 'Return',
  ADJUSTMENT: 'Adjustment',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  RECONCILIATION: 'Stock count',
};
