import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Pagination } from '../components/ui/Pagination';
import { useActiveMembership } from '../features/auth/hooks';
import { hasRole } from '../features/navigation';
import { useSales } from '../features/sales/hooks';
import { PAYMENT_LABEL } from '../features/sales/labels';
import { useSettings } from '../features/settings/hooks';
import { formatDateTime, formatMoney } from '../lib/format';

export function SalesPage() {
  const membership = useActiveMembership();
  const settings = useSettings();
  const [page, setPage] = useState(1);
  const sales = useSales(page);
  const seesAll = membership ? hasRole(membership.role, 'MANAGER') : false;
  const currency = settings.data?.currency ?? 'USD';
  const timeZone = settings.data?.timeZone ?? 'UTC';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-navy-900">Sales</h1>
      {!seesAll && <p className="mt-1 text-sm text-slate-600">You see the sales you made.</p>}

      <div className="mt-6">
        {sales.isPending ? (
          <p role="status" className="text-slate-500">
            Loading sales…
          </p>
        ) : sales.isError ? (
          <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            Could not load sales.
            <Button variant="secondary" className="ml-3" onClick={() => void sales.refetch()}>
              Retry
            </Button>
          </div>
        ) : sales.data.total === 0 ? (
          <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200">
            <p className="font-medium text-navy-900">No sales yet.</p>
            <p className="mt-1 text-sm text-slate-600">
              Open the{' '}
              <Link to="/pos" className="font-medium text-blue-600 hover:underline">
                point of sale
              </Link>{' '}
              to make the first one.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Receipt</th>
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                  {seesAll && <th scope="col" className="px-4 py-3 font-medium">Cashier</th>}
                  <th scope="col" className="px-4 py-3 text-right font-medium">Units</th>
                  <th scope="col" className="px-4 py-3 font-medium">Payment</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.data.items.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      <Link to={`/sales/${s.id}`} className="font-medium text-blue-600 hover:underline">
                        {s.reference}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDateTime(s.createdAt, timeZone)}</td>
                    {seesAll && <td className="px-4 py-3">{s.cashierName}</td>}
                    <td className="px-4 py-3 text-right">{s.unitCount}</td>
                    <td className="px-4 py-3">{s.paymentMethod ? PAYMENT_LABEL[s.paymentMethod] : '—'}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(s.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sales.data && (
          <Pagination page={sales.data.page} totalPages={sales.data.totalPages} total={sales.data.total} onPage={setPage} />
        )}
      </div>
    </div>
  );
}