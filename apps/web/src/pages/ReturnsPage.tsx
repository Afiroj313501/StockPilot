import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Pagination } from '../components/ui/Pagination';
import { useReturns } from '../features/returns/hooks';
import { PAYMENT_LABEL } from '../features/sales/labels';
import { useSettings } from '../features/settings/hooks';
import { formatDateTime, formatMoney } from '../lib/format';

export function ReturnsPage() {
  const settings = useSettings();
  const [page, setPage] = useState(1);
  const returns = useReturns(page);
  const currency = settings.data?.currency ?? 'USD';
  const timeZone = settings.data?.timeZone ?? 'UTC';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-navy-900">Returns</h1>
      <p className="mt-1 text-sm text-slate-600">
        Refunds are recorded here only. Open a sale from{' '}
        <Link to="/sales" className="font-medium text-blue-600 hover:underline">
          Sales
        </Link>{' '}
        to process a new return.
      </p>

      <div className="mt-6">
        {returns.isPending ? (
          <p role="status" className="text-slate-500">
            Loading returns…
          </p>
        ) : returns.isError ? (
          <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            Could not load returns.
            <Button variant="secondary" className="ml-3" onClick={() => void returns.refetch()}>
              Retry
            </Button>
          </div>
        ) : returns.data.total === 0 ? (
          <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200">
            <p className="font-medium text-navy-900">No returns yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Return
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Sale
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    By
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Units
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Refund method
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Refund
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {returns.data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium text-navy-900">{r.reference}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/sales/${r.saleId}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {r.saleReference}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateTime(r.createdAt, timeZone)}
                    </td>
                    <td className="px-4 py-3">{r.processedByName}</td>
                    <td className="px-4 py-3 text-right">{r.unitCount}</td>
                    <td className="px-4 py-3">{PAYMENT_LABEL[r.refundMethod]}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(r.refundTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {returns.data && (
          <Pagination
            page={returns.data.page}
            totalPages={returns.data.totalPages}
            total={returns.data.total}
            onPage={setPage}
          />
        )}
      </div>
    </div>
  );
}
