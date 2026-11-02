import type { ReturnReason } from '../../types/api';

export const REASON_LABEL: Record<ReturnReason, string> = {
  CHANGED_MIND: 'Changed their mind',
  DAMAGED: 'Damaged or faulty',
  WRONG_ITEM: 'Wrong item',
  OTHER: 'Other',
};
