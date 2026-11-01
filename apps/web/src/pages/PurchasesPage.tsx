import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagination } from '../components/ui/Pagination';
import { usePurchases, type PurchaseFilters } from '../features/purchases/hooks';
import { STATUS_LABEL, StatusBadge } from '../features/purchases/status';
import { useSettings } from '../features/settings/hooks';
import { formatDate, formatMoney } from '../lib/format';

export function PurchasesPage() {
  const [status, setStatus] = useState<PurchaseFilters['status']>('');
  const [page, setPage] = useState(1);
  const purchases = usePurchases({ status, page });
  const settings = useSettings();
  const currency = settings.data?.currency ?? 'USD';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-navy-900">Purchase orders</h1>
        <Link
          to="/purchases/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> New purchase
        </Link>
      </div>
      <div className="mt-6">
        <label className="text-sm text-slate-600">
          Status
          <select
            aria-label="Purchase order status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as PurchaseFilters['status']);
              setPage(1);
            }}
            className="ml-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {purchases.isError ? (
          <p role="alert" className="p-6 text-sm text-red-700">
            Purchase orders could not be loaded.
          </p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Expected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchases.data?.items.map((purchase) => (
                <tr key={purchase.id}>
                  <td className="px-4 py-3">
                    <Link
                      to={`/purchases/${purchase.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {purchase.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{purchase.supplierName}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={purchase.status} />
                  </td>
                  <td className="px-4 py-3 text-right">{formatMoney(purchase.total, currency)}</td>
                  <td className="px-4 py-3">
                    {purchase.expectedDate ? formatDate(purchase.expectedDate) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {purchases.data && (
          <Pagination
            page={purchases.data.page}
            totalPages={purchases.data.totalPages}
            total={purchases.data.total}
            onPage={setPage}
          />
        )}
      </div>
    </div>
  );
}
