import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import type { PurchaseDetail } from '../../types/api';
import { useReceivePurchase } from './hooks';

function ReceiveForm({ order, onClose }: { order: PurchaseDetail; onClose: () => void }) {
  const receive = useReceivePurchase();
  const open = order.items.filter((i) => i.quantityRemaining > 0);
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((i) => [i.productId, String(i.quantityRemaining)])),
  );
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // One idempotency key per distinct request: retrying the same values re-uses it,
  // so a repeated submit can never be applied twice.
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const lines: { productId: string; quantity: number }[] = [];
    const found: Record<string, string> = {};
    for (const item of open) {
      const v = (qty[item.productId] ?? '').trim();
      if (v === '' || v === '0') continue;
      if (!/^\d+$/.test(v)) found[item.productId] = 'Whole number';
      else if (Number(v) > item.quantityRemaining)
        found[item.productId] = `At most ${item.quantityRemaining}`;
      else lines.push({ productId: item.productId, quantity: Number(v) });
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (lines.length === 0) {
      setFormError('Enter a quantity for at least one product.');
      return;
    }

    const signature = JSON.stringify([order.id, lines, note.trim()]);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: crypto.randomUUID() };
    }
    receive.mutate(
      {
        id: order.id,
        body: {
          idempotencyKey: attempt.current.key,
          note: note.trim() === '' ? null : note.trim(),
          items: lines,
        },
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
        Enter what actually arrived. Leave a line at 0 if it did not come. Stock is updated by
        exactly these quantities.
      </p>
      {formError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {open.map((item) => (
          <li key={item.productId} className="flex items-start justify-between gap-3 py-3">
            <div className="text-sm">
              <div className="font-medium text-navy-900">{item.productName}</div>
              <div className="text-xs text-slate-500">
                {item.productSku} · ordered {item.quantityOrdered}, received {item.quantityReceived}
                , {item.quantityRemaining} to go
              </div>
            </div>
            <div>
              <input
                aria-label={`Quantity received for ${item.productName}`}
                inputMode="numeric"
                value={qty[item.productId] ?? ''}
                onChange={(ev) =>
                  setQty((prev) => ({ ...prev, [item.productId]: ev.target.value }))
                }
                className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              {errors[item.productId] && (
                <p role="alert" className="mt-1 text-xs text-red-600">
                  {errors[item.productId]}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <TextField
        label="Note (optional)"
        hint="For example a delivery note number."
        value={note}
        onChange={(ev) => setNote(ev.target.value)}
      />
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={receive.isPending}>
          Receive stock
        </Button>
      </div>
    </form>
  );
}

export function ReceiveDialog({
  order,
  open,
  onClose,
}: {
  order: PurchaseDetail;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={`Receive stock for ${order.reference}`}>
      {open && <ReceiveForm order={order} onClose={onClose} />}
    </Modal>
  );
}
