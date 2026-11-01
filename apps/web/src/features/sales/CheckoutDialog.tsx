import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import type { CartDiscount, PaymentMethod, SaleDetail, SalePreview } from '../../types/api';
import { useCheckout } from './hooks';
import { PAYMENT_LABEL } from './labels';

interface Props {
  open: boolean;
  onClose: () => void;
  preview: SalePreview;
  items: { productId: string; quantity: number }[];
  discount: CartDiscount | null;
  customerName: string;
  onDone: (sale: SaleDetail) => void;
}

const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;
const toCents = (v: string) => Math.round(Number(v) * 100);

function CheckoutForm({
  preview,
  items,
  discount,
  customerName,
  onDone,
  onClose,
}: Omit<Props, 'open'>) {
  const checkout = useCheckout();
  const qc = useQueryClient();
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [tendered, setTendered] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // One idempotency key per distinct request: a double click or retry re-uses it,
  // so the same sale can never be saved twice.
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const isCash = method === 'CASH';
  const amount = isCash ? tendered.trim() : preview.total;
  const totalCents = toCents(preview.total);
  const changeCents = isCash && AMOUNT_RE.test(amount) ? toCents(amount) - totalCents : 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!AMOUNT_RE.test(amount)) return setError('Enter an amount like 12.50');
    if (isCash && toCents(amount) < totalCents) {
      return setError(`Not enough. The total is ${formatMoney(preview.total, preview.currency)}.`);
    }
    setError(null);

    const name = customerName.trim() === '' ? null : customerName.trim();
    const signature = JSON.stringify([items, discount, name, method, amount, preview.total]);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: crypto.randomUUID() };
    }

    checkout.mutate(
      {
        idempotencyKey: attempt.current.key,
        items,
        discount,
        customerName: name,
        payment: { method, amountTendered: Number(amount) },
        expectedTotal: Number(preview.total),
      },
      {
        onSuccess: onDone,
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'TOTAL_MISMATCH') {
            void qc.invalidateQueries({ queryKey: ['sales', 'preview'] }); // show the new total
          }
          setFormError(
            err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
          );
        },
      },
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-center text-sm text-slate-600">
        Amount due
        <span className="block text-3xl font-semibold text-navy-900">
          {formatMoney(preview.total, preview.currency)}
        </span>
      </p>

      {formError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <SelectField
        label="Payment method"
        value={method}
        onChange={(e) => setMethod(e.target.value as PaymentMethod)}
      >
        {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
          <option key={m} value={m}>
            {PAYMENT_LABEL[m]}
          </option>
        ))}
      </SelectField>

      {isCash ? (
        <div>
          <TextField
            label="Cash received"
            inputMode="decimal"
            value={tendered}
            onChange={(e) => setTendered(e.target.value)}
            error={error ?? undefined}
            autoFocus
          />
          <div className="mt-2 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => setTendered(preview.total)}
              className="font-medium text-blue-600 hover:underline"
            >
              Exact amount
            </button>
            {changeCents > 0 && (
              <span role="status" className="font-semibold text-navy-900">
                Change due: {formatMoney((changeCents / 100).toFixed(2), preview.currency)}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          Record that the full amount was received by this method. StockPilot does not process card
          or wallet payments; it only records them.
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Back to cart
        </Button>
        <Button type="submit" loading={checkout.isPending}>
          Confirm sale
        </Button>
      </div>
    </form>
  );
}

export function CheckoutDialog(props: Props) {
  return (
    <Modal open={props.open} onClose={props.onClose} title="Complete sale">
      {props.open && <CheckoutForm {...props} />}
    </Modal>
  );
}
