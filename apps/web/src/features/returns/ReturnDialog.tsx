import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useDebounce } from '../../lib/useDebounce';
import type { CreateReturnPayload, ReturnReason, SaleReturnable } from '../../types/api';
import { PAYMENT_LABEL } from '../sales/labels';
import { useCreateReturn, useReturnPreview } from './hooks';
import { REASON_LABEL } from './labels';

interface RowState {
  qty: string;
  reason: ReturnReason;
  restock: boolean;
}

function ReturnForm({ data, onClose }: { data: SaleReturnable; onClose: () => void }) {
  const create = useCreateReturn();
  const open = data.lines.filter((l) => l.quantityReturnable > 0);
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      open.map((l) => [
        l.productId,
        { qty: '', reason: 'CHANGED_MIND' as ReturnReason, restock: true },
      ]),
    ),
  );
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // One idempotency key per distinct request: a double click or retry re-uses it,
  // so the same return can never be recorded twice.
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const patchRow = (productId: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [productId]: { ...(prev[productId] as RowState), ...patch } }));

  // Lines with a valid quantity, used for the live refund preview from the server.
  const items = open.flatMap((l) => {
    const q = (rows[l.productId]?.qty ?? '').trim();
    return /^\d+$/.test(q) && Number(q) >= 1 && Number(q) <= l.quantityReturnable
      ? [{ productId: l.productId, quantity: Number(q) }]
      : [];
  });
  const key = JSON.stringify(items);
  const debouncedKey = useDebounce(key, 300);
  const debouncedItems = useMemo(() => JSON.parse(debouncedKey) as typeof items, [debouncedKey]);
  const preview = useReturnPreview(data.saleId, debouncedItems);
  const showPreview = items.length > 0 && preview.data;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const lines: CreateReturnPayload['items'] = [];
    const found: Record<string, string> = {};
    for (const l of open) {
      const row = rows[l.productId];
      const q = (row?.qty ?? '').trim();
      if (q === '' || q === '0') continue;
      if (!/^\d+$/.test(q)) {
        found[l.productId] = 'Whole number';
        continue;
      }
      if (Number(q) > l.quantityReturnable) {
        found[l.productId] = `At most ${l.quantityReturnable}`;
        continue;
      }
      const reason = row?.reason ?? 'CHANGED_MIND';
      lines.push({
        productId: l.productId,
        quantity: Number(q),
        reason,
        restock: reason === 'DAMAGED' ? false : (row?.restock ?? true),
      });
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (lines.length === 0) {
      setFormError('Enter a quantity for at least one product.');
      return;
    }

    const trimmedNote = note.trim();
    const signature = JSON.stringify([data.saleId, lines, trimmedNote]);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: crypto.randomUUID() };
    }
    create.mutate(
      {
        saleId: data.saleId,
        idempotencyKey: attempt.current.key,
        note: trimmedNote === '' ? null : trimmedNote,
        items: lines,
      },
      {
        onSuccess: onClose,
        onError: (err) =>
          setFormError(
            err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
          ),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">
        Enter how many units came back. For each product, choose the reason and whether the units go
        back into stock.
      </p>
      {formError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {open.map((l) => {
          const row = rows[l.productId] ?? {
            qty: '',
            reason: 'CHANGED_MIND' as ReturnReason,
            restock: true,
          };
          const damaged = row.reason === 'DAMAGED';
          return (
            <li key={l.productId} className="space-y-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium text-navy-900">{l.productName}</div>
                  <div className="text-xs text-slate-500">
                    {l.productSku} · sold {l.quantitySold}, returned {l.quantityReturned}, can
                    return {l.quantityReturnable}
                  </div>
                </div>
                <div>
                  <input
                    aria-label={`Units returned of ${l.productName}`}
                    inputMode="numeric"
                    placeholder="0"
                    value={row.qty}
                    onChange={(ev) => patchRow(l.productId, { qty: ev.target.value })}
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {errors[l.productId] && (
                    <p role="alert" className="mt-1 text-xs text-red-600">
                      {errors[l.productId]}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  aria-label={`Reason for ${l.productName}`}
                  value={row.reason}
                  onChange={(ev) =>
                    patchRow(l.productId, { reason: ev.target.value as ReturnReason })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {(Object.keys(REASON_LABEL) as ReturnReason[]).map((r) => (
                    <option key={r} value={r}>
                      {REASON_LABEL[r]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={damaged ? false : row.restock}
                    disabled={damaged}
                    onChange={(ev) => patchRow(l.productId, { restock: ev.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  Return to stock
                </label>
              </div>
              {damaged && (
                <p className="text-xs text-slate-500">Damaged items are not put back into stock.</p>
              )}
            </li>
          );
        })}
      </ul>

      <TextField
        label="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
      />

      <div role="status" className="rounded-lg bg-slate-50 p-3 text-sm">
        {showPreview ? (
          <>
            <p className="font-semibold text-navy-900">
              Refund due: {formatMoney(preview.data.refundTotal, preview.data.currency)}
            </p>
            <p className="text-slate-600">
              Calculated from the original sale (discount and tax included). Pay it back by{' '}
              {PAYMENT_LABEL[preview.data.refundMethod].toLowerCase()}.
            </p>
          </>
        ) : (
          <p className="text-slate-600">
            The refund amount appears here once you enter a quantity.
          </p>
        )}
        {preview.isError && items.length > 0 && (
          <p className="mt-1 text-red-700">
            {preview.error instanceof ApiError
              ? preview.error.message
              : 'Could not work out the refund.'}
          </p>
        )}
      </div>
      <p className="text-xs text-slate-500">
        StockPilot records this refund only. It does not send money to a card or wallet, so give the
        refund through your normal payment method.
      </p>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Record return
        </Button>
      </div>
    </form>
  );
}

export function ReturnDialog({
  data,
  open,
  onClose,
}: {
  data: SaleReturnable;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={`Return items from ${data.saleReference}`}>
      {open && <ReturnForm data={data} onClose={onClose} />}
    </Modal>
  );
}
