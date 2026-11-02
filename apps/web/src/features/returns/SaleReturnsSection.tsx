import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { formatDateTime, formatMoney } from '../../lib/format';
import { PAYMENT_LABEL } from '../sales/labels';
import { useSaleReturnable } from './hooks';
import { REASON_LABEL } from './labels';
import { ReturnDialog } from './ReturnDialog';

const STATUS_TEXT = {
  NONE: 'No returns',
  PARTIAL: 'Partly returned',
  FULL: 'Fully returned',
} as const;

export function SaleReturnsSection({
  saleId,
  currency,
  timeZone,
}: {
  saleId: string;
  currency: string;
  timeZone: string;
}) {
  const data = useSaleReturnable(saleId);
  const [open, setOpen] = useState(false);

  if (data.isPending) {
    return (
      <p role="status" className="text-slate-500">
        Loading returns…
      </p>
    );
  }
  if (data.isError) {
    return (
      <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
        Could not load returns.
        <Button variant="secondary" className="ml-3" onClick={() => void data.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const d = data.data;
  const canReturn = d.saleStatus === 'COMPLETED' && d.lines.some((l) => l.quantityReturnable > 0);

  return (
    <section aria-labelledby="returns-heading" className="mx-auto max-w-sm space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="returns-heading" className="text-lg font-semibold text-navy-900">
          Returns
        </h2>
        <span className="text-sm text-slate-600">{STATUS_TEXT[d.returnStatus]}</span>
      </div>

      {canReturn && <Button onClick={() => setOpen(true)}>Process return</Button>}

      {d.returns.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing has been returned from this sale.</p>
      ) : (
        <ul className="space-y-3">
          {d.returns.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200"
            >
              <p className="font-medium text-navy-900">
                {r.reference} · {formatMoney(r.refundTotal, currency)}
              </p>
              <p className="text-slate-600">
                {formatDateTime(r.createdAt, timeZone)} · {r.processedByName} · refund recorded as{' '}
                {PAYMENT_LABEL[r.refundMethod].toLowerCase()}
              </p>
              {r.note && <p className="text-slate-600">{r.note}</p>}
              <ul className="mt-2 text-slate-700">
                {r.items.map((i) => (
                  <li key={i.productId}>
                    {i.quantity} × {i.productName} · {REASON_LABEL[i.reason]} ·{' '}
                    {i.restock ? 'back in stock' : 'not restocked'} ·{' '}
                    {formatMoney(i.refundAmount, currency)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <ReturnDialog data={d} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
