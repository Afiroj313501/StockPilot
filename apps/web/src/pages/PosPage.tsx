import { Minus, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { SelectField } from '../components/ui/SelectField';
import { TextField } from '../components/ui/TextField';
import { useActiveMembership } from '../features/auth/hooks';
import { useProducts } from '../features/catalog/hooks';
import { hasRole } from '../features/navigation';
import { CheckoutDialog } from '../features/sales/CheckoutDialog';
import { useSalePreview } from '../features/sales/hooks';
import type { CartLine } from '../features/sales/labels';
import { useSettings } from '../features/settings/hooks';
import { api, ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import { useDebounce } from '../lib/useDebounce';
import type { CartDiscount, Paginated, Product, SaleDetail } from '../types/api';

const DISCOUNT_RE = { PERCENT: /^\d{1,3}(\.\d{1,2})?$/, AMOUNT: /^\d{1,9}(\.\d{1,2})?$/ };

function parseDiscount(type: CartDiscount['type'], text: string): CartDiscount | null {
  const t = text.trim();
  if (!DISCOUNT_RE[type].test(t)) return null;
  const value = Number(t);
  if (value <= 0 || (type === 'PERCENT' && value > 100)) return null;
  return { type, value };
}

const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600';

export function PosPage() {
  const navigate = useNavigate();
  const membership = useActiveMembership();
  const settings = useSettings();
  const canDiscount = membership ? hasRole(membership.role, 'MANAGER') : false;
  const allowNegative = settings.data?.allowNegativeStock ?? false;
  const currency = settings.data?.currency ?? 'USD';

  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim(), 250);
  const results = useProducts({
    search: term,
    categoryId: '',
    status: 'active',
    sort: 'name',
    order: 'asc',
    page: 1,
    pageSize: 8,
  });

  const [cart, setCart] = useState<CartLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [customer, setCustomer] = useState('');
  const [discountType, setDiscountType] = useState<CartDiscount['type']>('PERCENT');
  const [discountText, setDiscountText] = useState('');
  const debouncedDiscount = useDebounce(discountText.trim(), 300);
  const [paying, setPaying] = useState(false);

  const discount = canDiscount ? parseDiscount(discountType, debouncedDiscount) : null;
  const discountInvalid = discountText.trim() !== '' && parseDiscount(discountType, discountText) === null;
  const discountPending = discountText.trim() !== debouncedDiscount;

  const items = cart.map((l) => ({ productId: l.productId, quantity: l.quantity }));
  const preview = useSalePreview(items, discount);
  const priced = cart.length > 0 ? preview.data : undefined;
  const previewError =
    cart.length > 0 && preview.error
      ? preview.error instanceof ApiError
        ? preview.error.message
        : 'Could not price the sale.'
      : null;

  const addProduct = (p: Product) => {
    const existing = cart.find((l) => l.productId === p.id);
    const next = (existing?.quantity ?? 0) + 1;
    if (!allowNegative && next > p.stockQuantity) {
      setNotice(`Only ${p.stockQuantity} of “${p.name}” in stock.`);
      return;
    }
    setNotice(null);
    setCart(
      existing
        ? cart.map((l) => (l.productId === p.id ? { ...l, quantity: next, stock: p.stockQuantity } : l))
        : [
            ...cart,
            { productId: p.id, name: p.name, sku: p.sku, unitPrice: p.sellingPrice, stock: p.stockQuantity, quantity: 1 },
          ],
    );
    setSearch('');
    searchRef.current?.focus();
  };

  const setQuantity = (productId: string, raw: number) => {
    const line = cart.find((l) => l.productId === productId);
    if (!line || !Number.isFinite(raw)) return;
    const quantity = Math.min(Math.max(Math.trunc(raw), 1), 100_000);
    if (!allowNegative && quantity > line.stock) {
      setNotice(`Only ${line.stock} of “${line.name}” in stock.`);
      return;
    }
    setNotice(null);
    setCart(cart.map((l) => (l.productId === productId ? { ...l, quantity } : l)));
  };

  // A barcode scanner types the code and presses Enter: pick an exact barcode or SKU match.
  const onSearchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    try {
      const res = await api<Paginated<Product>>(`/products?${new URLSearchParams({ search: q, status: 'active', pageSize: '5' })}`);
      const lower = q.toLowerCase();
      const exact = res.items.find((p) => p.barcode?.toLowerCase() === lower || p.sku.toLowerCase() === lower);
      const pick = exact ?? (res.items.length === 1 ? res.items[0] : undefined);
      if (pick) addProduct(pick);
      else setNotice(res.items.length === 0 ? `No product found for “${q}”.` : 'Several products match. Pick one from the list.');
    } catch {
      setNotice('Could not search products.');
    }
  };

  const onDone = (sale: SaleDetail) => {
    setCart([]);
    setCustomer('');
    setDiscountText('');
    setPaying(false);
    navigate(`/sales/${sale.id}`, { state: { justSold: true } });
  };

  const canCharge =
    cart.length > 0 && Boolean(priced) && !previewError && !preview.isFetching && !discountInvalid && !discountPending;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <section aria-labelledby="pos-search-heading">
        <h1 id="pos-search-heading" className="text-2xl font-semibold text-navy-900">
          Point of sale
        </h1>
        <form onSubmit={(e) => void onSearchSubmit(e)} className="mt-4">
          <label htmlFor="pos-search" className="block text-sm font-medium text-navy-900">
            Scan a barcode or search
          </label>
          <input
            id="pos-search"
            ref={searchRef}
            type="search"
            autoFocus
            autoComplete="off"
            placeholder="Barcode, SKU or product name, then Enter"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} mt-1`}
          />
        </form>

        {notice && (
          <div role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {notice}
          </div>
        )}

        {term !== '' && (
          <ul aria-label="Search results" className="mt-3 divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {results.isError ? (
              <li className="px-4 py-3 text-sm text-red-700">Could not search products.</li>
            ) : (results.data?.items ?? []).length === 0 ? (
              <li className="px-4 py-3 text-sm text-slate-500">{results.isFetching ? 'Searching…' : 'No matching products.'}</li>
            ) : (
              (results.data?.items ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addProduct(p)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                  >
                    <span>
                      <span className="block font-medium text-navy-900">{p.name}</span>
                      <span className="text-xs text-slate-500">
                        {p.sku}
                        {p.barcode ? ` · ${p.barcode}` : ''} · {p.stockQuantity} in stock
                      </span>
                    </span>
                    <span className="font-medium text-navy-900">{formatMoney(p.sellingPrice, currency)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </section>

      <section aria-labelledby="cart-heading" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <h2 id="cart-heading" className="text-lg font-semibold text-navy-900">
            Cart
          </h2>
          {cart.length > 0 && (
            <button type="button" onClick={() => setCart([])} className="text-sm font-medium text-slate-600 hover:underline">
              Clear
            </button>
          )}
        </div>

        {cart.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">The cart is empty. Scan or search to add products.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {cart.map((l) => {
              const line = priced?.lines.find((x) => x.productId === l.productId);
              return (
                <li key={l.productId} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm">
                      <div className="font-medium text-navy-900">{l.name}</div>
                      <div className="text-xs text-slate-500">
                        {l.sku} · {formatMoney(l.unitPrice, currency)} each
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${l.name}`}
                      onClick={() => setCart(cart.filter((x) => x.productId !== l.productId))}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Decrease quantity of ${l.name}`}
                        onClick={() => setQuantity(l.productId, l.quantity - 1)}
                        className="rounded-lg p-1.5 ring-1 ring-slate-300 hover:bg-slate-50"
                      >
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <input
                        aria-label={`Quantity of ${l.name}`}
                        inputMode="numeric"
                        value={l.quantity}
                        onChange={(e) => setQuantity(l.productId, Number(e.target.value))}
                        className="w-14 rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      <button
                        type="button"
                        aria-label={`Increase quantity of ${l.name}`}
                        onClick={() => setQuantity(l.productId, l.quantity + 1)}
                        className="rounded-lg p-1.5 ring-1 ring-slate-300 hover:bg-slate-50"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <span className="text-sm font-medium text-navy-900">
                      {line ? formatMoney(line.lineSubtotal, currency) : '…'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {cart.length > 0 && (
          <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
            <TextField
              label="Customer name (optional)"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              maxLength={100}
            />

            {canDiscount && (
              <div className="grid grid-cols-[8rem_1fr] gap-2">
                <SelectField
                  label="Discount"
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as CartDiscount['type'])}
                >
                  <option value="PERCENT">Percent</option>
                  <option value="AMOUNT">Amount</option>
                </SelectField>
                <TextField
                  label="Value"
                  inputMode="decimal"
                  value={discountText}
                  onChange={(e) => setDiscountText(e.target.value)}
                  error={discountInvalid ? 'Enter a number above 0 (percent up to 100)' : undefined}
                />
              </div>
            )}

            {previewError && (
              <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {previewError}
              </div>
            )}

            {priced && (
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Subtotal</dt>
                  <dd>{formatMoney(priced.subtotal, currency)}</dd>
                </div>
                {Number(priced.discountTotal) > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Discount</dt>
                    <dd>−{formatMoney(priced.discountTotal, currency)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate-600">
                    {priced.taxName} ({priced.taxRatePercent}%{priced.taxInclusive ? ', included' : ''})
                  </dt>
                  <dd>{formatMoney(priced.taxTotal, currency)}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-semibold text-navy-900">
                  <dt>Total</dt>
                  <dd>{formatMoney(priced.total, currency)}</dd>
                </div>
              </dl>
            )}

            <Button className="w-full" disabled={!canCharge} onClick={() => setPaying(true)}>
              Charge
            </Button>
          </div>
        )}
      </section>

      {priced && (
        <CheckoutDialog
          open={paying}
          onClose={() => setPaying(false)}
          preview={priced}
          items={items}
          discount={discount}
          customerName={customer}
          onDone={onDone}
        />
      )}
    </div>
  );
}