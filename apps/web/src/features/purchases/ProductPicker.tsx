import { useState } from 'react';
import { useDebounce } from '../../lib/useDebounce';
import type { Product } from '../../types/api';
import { useProducts } from '../catalog/hooks';

interface Props {
  onPick: (product: Product) => void;
  excludeIds: string[];
}

export function ProductPicker({ onPick, excludeIds }: Props) {
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
  const visible = (results.data?.items ?? []).filter((p) => !excludeIds.includes(p.id));

  return (
    <div>
      <label htmlFor="product-search" className="block text-sm font-medium text-navy-900">
        Add a product
      </label>
      <input
        id="product-search"
        type="search"
        placeholder="Search name, SKU or barcode"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
      />
      {term !== '' && (
        <ul
          aria-label="Search results"
          className="mt-2 divide-y divide-slate-100 rounded-lg bg-white shadow-sm ring-1 ring-slate-200"
        >
          {results.isError ? (
            <li className="px-3 py-2 text-sm text-red-700">Could not search products.</li>
          ) : visible.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">
              {results.isFetching ? 'Searching…' : 'No matching products.'}
            </li>
          ) : (
            visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(p);
                    setSearch('');
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  <span className="font-medium text-navy-900">{p.name}</span>
                  <span className="text-xs text-slate-500">
                    {p.sku} · {p.stockQuantity} in stock
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
