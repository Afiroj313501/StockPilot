import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import type { ReorderItem, ReorderParams } from '../../types/api';
import { useSupplierOptions } from '../suppliers/hooks';
import { useCreateDraft } from './hooks';

interface Props {
  item: ReorderItem | null;
  params: ReorderParams;
  currency: string;
  onClose: () => void;
}

function DraftForm({
  item,
  params,
  currency,
  onClose,
}: Omit<Props, 'item'> & { item: ReorderItem }) {
  const navigate = useNavigate();
  const suppliers = useSupplierOptions();
  const create = useCreateDraft();
  const [quantity, setQuantity] = useState(String(item.recommendedQuantity ?? ''));
  const [supplierId, setSupplierId] = useState(item.supplier?.isActive ? item.supplier.id : '');
  const [errors, setErrors] = useState<{ quantity?: string; supplier?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const q = quantity.trim();
  const estimate = /^\d+$/.test(q)
    ? formatMoney(
        ((Number(q) * Math.round(Number(item.unitCost) * 100)) / 100).toFixed(2),
        currency,
      )
    : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const found: typeof errors = {};
    if (!/^\d+$/.test(q) || Number(q) < 1 || Number(q) > 1_000_000)
      found.quantity = 'Whole number, 1 or more';
    if (!supplierId) found.supplier = 'Choose a supplier';
    setErrors(found);
    if (found.quantity || found.supplier) return;

    const signature = JSON.stringify([item.productId, Number(q), supplierId, params]);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: crypto.randomUUID() };
    }
    create.mutate(
      {
        productId: item.productId,
        body: { idempotencyKey: attempt.current.key, quantity: Number(q), supplierId, params },
      },
      {
        onSuccess: (order) => {
          onClose();
          navigate(`/purchases/${order.id}`);
        },
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
        This creates a <strong>draft</strong> purchase order. Nothing is sent to the supplier: you
        can edit it, submit it and have the owner approve it from the Purchases page.
      </p>
      {formError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}
      <p className="text-sm text-slate-700">
        <span className="font-medium text-navy-900">{item.name}</span> ({item.sku}): recommended{' '}
        <strong>{item.recommendedQuantity}</strong> unit(s).
      </p>
      <TextField
        label="Quantity to order"
        inputMode="numeric"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        hint={
          estimate
            ? `Estimated cost ${estimate} at the cost price of ${formatMoney(item.unitCost, currency)}.`
            : undefined
        }
        error={errors.quantity}
      />
      <SelectField
        label="Supplier"
        value={supplierId}
        onChange={(e) => setSupplierId(e.target.value)}
        hint={
          item.supplier
            ? item.supplier.isActive
              ? 'Taken from the most recent order for this product.'
              : `${item.supplier.name} is archived: choose another supplier.`
            : 'This product has no order history yet, so choose a supplier.'
        }
        error={errors.supplier}
      >
        <option value="">Choose a supplier</option>
        {(suppliers.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </SelectField>
      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create draft order'}
        </Button>
      </div>
    </form>
  );
}

export function CreateDraftDialog({ item, params, currency, onClose }: Props) {
  return (
    <Modal open={item !== null} onClose={onClose} title="Create a draft purchase order">
      {item && <DraftForm item={item} params={params} currency={currency} onClose={onClose} />}
    </Modal>
  );
}
