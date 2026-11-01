import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import type { Product, PurchaseDetail, PurchasePayload } from '../../types/api';
import { useSettings } from '../settings/hooks';
import { useSupplierOptions } from '../suppliers/hooks';
import { useCreatePurchase, useUpdatePurchase } from './hooks';
import { ProductPicker } from './ProductPicker';

interface Line {
  productId: string;
  name: string;
  sku: string;
  quantity: string;
  unitCost: string;
}

interface Errors {
  supplier?: string;
  lines?: string;
  notes?: string;
  line: Record<string, { quantity?: string; unitCost?: string }>;
}

const COST_RE = /^\d{1,9}(\.\d{1,2})?$/;
const QTY_RE = /^\d+$/;

// Mirrors the API rules. The server is still the authority and recomputes every total.
function validate(supplierId: string, notes: string, lines: Line[]): Errors {
  const errors: Errors = { line: {} };
  if (!supplierId) errors.supplier = 'Choose a supplier';
  if (lines.length === 0) errors.lines = 'Add at least one product';
  if (notes.length > 1000) errors.notes = 'Use at most 1000 characters';
  for (const l of lines) {
    const e: { quantity?: string; unitCost?: string } = {};
    const q = l.quantity.trim();
    if (!QTY_RE.test(q) || Number(q) < 1 || Number(q) > 1_000_000)
      e.quantity = 'Whole number, 1 or more';
    if (!COST_RE.test(l.unitCost.trim())) e.unitCost = 'Amount like 12.50';
    if (e.quantity || e.unitCost) errors.line[l.productId] = e;
  }
  return errors;
}

const hasErrors = (e: Errors) =>
  Boolean(e.supplier || e.lines || e.notes || Object.keys(e.line).length);

function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (err.code === 'VALIDATION_ERROR' && err.details?.length) {
    return err.details.map((d) => `${d.field}: ${d.message}`).join('; ');
  }
  return err.message;
}

export function PurchaseForm({ initial }: { initial?: PurchaseDetail }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const suppliers = useSupplierOptions();
  const create = useCreatePurchase();
  const update = useUpdatePurchase();

  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? '');
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(
    initial
      ? initial.items.map((i) => ({
          productId: i.productId,
          name: i.productName,
          sku: i.productSku,
          quantity: String(i.quantityOrdered),
          unitCost: i.unitCost,
        }))
      : [],
  );
  const [errors, setErrors] = useState<Errors>({ line: {} });
  const [formError, setFormError] = useState<string | null>(null);

  const currency = settings.data?.currency ?? 'USD';
  const options = suppliers.data ?? [];
  const extraSupplier =
    initial && !options.some((s) => s.id === initial.supplierId)
      ? { id: initial.supplierId, name: `${initial.supplierName} (archived)` }
      : null;

  const addProduct = (p: Product) =>
    setLines((prev) => [
      ...prev,
      { productId: p.id, name: p.name, sku: p.sku, quantity: '1', unitCost: p.costPrice ?? '' },
    ]);
  const patchLine = (productId: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));

  // Preview only, in whole cents to avoid floating-point drift.
  const totalCents = lines.reduce((sum, l) => {
    const q = QTY_RE.test(l.quantity.trim()) ? Number(l.quantity) : 0;
    const c = COST_RE.test(l.unitCost.trim()) ? Math.round(Number(l.unitCost) * 100) : 0;
    return sum + q * c;
  }, 0);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const found = validate(supplierId, notes, lines);
    setErrors(found);
    if (hasErrors(found)) return;

    const payload: PurchasePayload = {
      supplierId,
      notes: notes.trim() === '' ? null : notes.trim(),
      expectedDate: expectedDate === '' ? null : expectedDate,
      items: lines.map((l) => ({
        productId: l.productId,
        quantityOrdered: Number(l.quantity),
        unitCost: Number(l.unitCost),
      })),
    };
    const callbacks = {
      onSuccess: (order: PurchaseDetail) => navigate(`/purchases/${order.id}`),
      onError: (err: unknown) => setFormError(describeError(err)),
    };
    if (initial) update.mutate({ id: initial.id, body: payload }, callbacks);
    else create.mutate(payload, callbacks);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {formError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <fieldset className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <legend className="px-1 text-sm font-semibold text-navy-900">Order details</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Supplier"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            error={errors.supplier}
          >
            <option value="">Choose a supplier</option>
            {extraSupplier && <option value={extraSupplier.id}>{extraSupplier.name}</option>}
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Expected delivery (optional)"
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
          />
          <div className="sm:col-span-2">
            <label htmlFor="po-notes" className="block text-sm font-medium text-navy-900">
              Notes (optional)
            </label>
            <textarea
              id="po-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            {errors.notes && (
              <p role="alert" className="mt-1 text-sm text-red-600">
                {errors.notes}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <legend className="px-1 text-sm font-semibold text-navy-900">Products</legend>
        <div className="mt-2 space-y-4">
          <ProductPicker onPick={addProduct} excludeIds={lines.map((l) => l.productId)} />
          {errors.lines && (
            <p role="alert" className="text-sm text-red-600">
              {errors.lines}
            </p>
          )}

          {lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Product
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Quantity
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Unit cost
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Line total
                    </th>
                    <th scope="col" className="py-2 pl-3">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l) => {
                    const e = errors.line[l.productId];
                    const q = QTY_RE.test(l.quantity.trim()) ? Number(l.quantity) : 0;
                    const c = COST_RE.test(l.unitCost.trim())
                      ? Math.round(Number(l.unitCost) * 100)
                      : 0;
                    return (
                      <tr key={l.productId} className="align-top">
                        <td className="py-2 pr-3">
                          <div className="font-medium text-navy-900">{l.name}</div>
                          <div className="text-xs text-slate-500">{l.sku}</div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            aria-label={`Quantity for ${l.name}`}
                            inputMode="numeric"
                            value={l.quantity}
                            onChange={(ev) => patchLine(l.productId, { quantity: ev.target.value })}
                            className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                          {e?.quantity && (
                            <p role="alert" className="mt-1 text-xs text-red-600">
                              {e.quantity}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            aria-label={`Unit cost for ${l.name}`}
                            inputMode="decimal"
                            value={l.unitCost}
                            onChange={(ev) => patchLine(l.productId, { unitCost: ev.target.value })}
                            className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                          {e?.unitCost && (
                            <p role="alert" className="mt-1 text-xs text-red-600">
                              {e.unitCost}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatMoney(((q * c) / 100).toFixed(2), currency)}
                        </td>
                        <td className="py-2 pl-3">
                          <button
                            type="button"
                            aria-label={`Remove ${l.name}`}
                            onClick={() =>
                              setLines((prev) => prev.filter((x) => x.productId !== l.productId))
                            }
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-right text-sm text-slate-600">
            Estimated total:{' '}
            <span className="font-semibold text-navy-900">
              {formatMoney((totalCents / 100).toFixed(2), currency)}
            </span>
            <span className="block text-xs">
              The server calculates the final total when you save.
            </span>
          </p>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={create.isPending || update.isPending}>
          {initial ? 'Save changes' : 'Save as draft'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigate(initial ? `/purchases/${initial.id}` : '/purchases')}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
