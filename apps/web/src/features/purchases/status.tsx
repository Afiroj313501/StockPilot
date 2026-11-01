import type { PurchaseStatus } from '../../types/api';

export const STATUS_LABEL: Record<PurchaseStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting approval',
  APPROVED: 'Approved',
  PARTIALLY_RECEIVED: 'Partly received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

const STYLE: Record<PurchaseStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SUBMITTED: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  PARTIALLY_RECEIVED: 'bg-indigo-100 text-indigo-800',
  RECEIVED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

export function StatusBadge({ status }: { status: PurchaseStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
