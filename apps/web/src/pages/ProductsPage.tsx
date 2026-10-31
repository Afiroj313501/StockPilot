import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Pagination } from '../components/ui/Pagination';
import { useActiveMembership } from '../features/auth/hooks';
import {
  useCategories,
  useProducts,
  useUpdateProduct,
  type ProductFilters,
} from '../features/catalog/hooks';
import { AdjustStockDialog, type StockTarget } from '../features/inventory/AdjustStockDialog';
import { hasRole } from '../features/navigation';
import { useSettings } from '../features/settings/hooks';
import { formatMoney } from '../lib/format';
import { useDebounce } from '../lib/useDebounce';
import type { Product } from '../types/api';
const control = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
export function ProductsPage() {
  const membership = useActiveMembership();
  const canManage = membership ? hasRole(membership.role, 'MANAGER') : false;
  const settings = useSettings();
  const categories = useCategories();
  const update = useUpdateProduct();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<ProductFilters['status']>('active');
  const [sortKey, setSortKey] = useState('name:asc');
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState<StockTarget | null>(null);
  const debouncedSearch = useDebounce(search.trim(), 300);
  const [sort, order] = sortKey.split(':') as [ProductFilters['sort'], ProductFilters['order']];
  const products = useProducts({
    search: debouncedSearch,
    categoryId,
    status,
    sort,
    order,
    page,
    pageSize: 20,
  });
  const threshold = settings.data?.defaultLowStockThreshold ?? 5;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Products</h1>
        {canManage && (
          <Link
            to="/products/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" />
            Add product
          </Link>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <input
          className={`${control} min-w-56 flex-1`}
          aria-label="Search products"
          placeholder="Search name, SKU or barcode"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className={control}
          aria-label="Filter by category"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All categories</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          className={control}
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ProductFilters['status']);
            setPage(1);
          }}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <select
          className={control}
          aria-label="Sort products"
          value={sortKey}
          onChange={(e) => {
            setSortKey(e.target.value);
            setPage(1);
          }}
        >
          <option value="name:asc">Name (A–Z)</option>
          <option value="name:desc">Name (Z–A)</option>
          <option value="sellingPrice:asc">Price low-high</option>
          <option value="stockQuantity:asc">Stock low-high</option>
          <option value="createdAt:desc">Newest first</option>
        </select>
      </div>
      {products.isPending ? (
        <p role="status" className="mt-5">
          Loading products…
        </p>
      ) : products.isError ? (
        <p role="alert" className="mt-5 text-red-700">
          Could not load products.
        </p>
      ) : products.data.total === 0 ? (
        <div className="mt-5 rounded-2xl bg-white p-10 text-center shadow-sm">
          No products match your filters.
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Price</th>
                {canManage && <th className="px-4 py-3 text-right">Cost</th>}
                <th className="px-4 py-3 text-right">Stock</th>
                {canManage && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.data.items.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  canManage={canManage}
                  currency={settings.data?.currency ?? 'USD'}
                  threshold={product.reorderThreshold ?? threshold}
                  onAdjust={setAdjusting}
                  onToggle={(isActive) => update.mutate({ id: product.id, body: { isActive } })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {products.data && (
        <Pagination
          page={products.data.page}
          totalPages={products.data.totalPages}
          total={products.data.total}
          onPage={setPage}
        />
      )}
      <AdjustStockDialog target={adjusting} onClose={() => setAdjusting(null)} />
    </div>
  );
}
function ProductRow({
  product,
  canManage,
  currency,
  threshold,
  onAdjust,
  onToggle,
}: {
  product: Product;
  canManage: boolean;
  currency: string;
  threshold: number;
  onAdjust: (target: StockTarget) => void;
  onToggle: (active: boolean) => void;
}) {
  const low = product.isActive && product.stockQuantity <= threshold;
  return (
    <tr className={!product.isActive ? 'bg-slate-50 text-slate-500' : ''}>
      <td className="px-4 py-3">
        <div className="font-medium">{product.name}</div>
        <div className="text-xs text-slate-500">{product.sku}</div>
      </td>
      <td className="px-4 py-3">{product.categoryName ?? '—'}</td>
      <td className="px-4 py-3 text-right">{formatMoney(product.sellingPrice, currency)}</td>
      {canManage && (
        <td className="px-4 py-3 text-right">
          {product.costPrice ? formatMoney(product.costPrice, currency) : '—'}
        </td>
      )}
      <td className={`px-4 py-3 text-right ${low ? 'font-semibold text-amber-700' : ''}`}>
        {product.stockQuantity}
      </td>
      {canManage && (
        <td className="px-4 py-3">
          <div className="flex gap-2">
            <Link className="text-blue-600 hover:underline" to={`/products/${product.id}/edit`}>
              Edit
            </Link>
            {product.isActive && (
              <button
                className="text-blue-600 hover:underline"
                onClick={() =>
                  onAdjust({
                    id: product.id,
                    name: product.name,
                    sku: product.sku,
                    stockQuantity: product.stockQuantity,
                  })
                }
              >
                Adjust
              </button>
            )}
            <button
              className="text-slate-600 hover:underline"
              onClick={() => onToggle(!product.isActive)}
            >
              {product.isActive ? 'Archive' : 'Restore'}
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}
