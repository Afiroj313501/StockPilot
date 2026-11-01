import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useSale } from '../features/sales/hooks';
import { PAYMENT_LABEL } from '../features/sales/labels';
import { useSettings } from '../features/settings/hooks';
import { formatDateTime, formatMoney } from '../lib/format';

export function SaleDetailPage() {
  const { id } = useParams();
  const sale = useSale(id);
  const settings = useSettings();
  const currency = settings.data?.currency ?? 'USD';
  const timeZone = settings.data?.timeZone ?? 'UTC';

  if (sale.isPending) {
    return (
      <p role="status" className="text-slate-500">
        Loading sale…
      </p>
    );
  }
  if (sale.isError) {
    return (
      <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        Could not load this sale.
        <Button variant="secondary" className="ml-3" onClick={() => void sale.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const detail = sale.data;
  return (
    <div className="print-receipt">
      <div className="flex items-start justify-between gap-4 print-hide">
        <div>
          <Link to="/sales" className="text-sm text-blue-600 hover:underline">
            Back to sales
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-navy-900">Receipt {detail.reference}</h1>
        </div>
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <p>When: {formatDateTime(detail.createdAt, timeZone)}</p>
          <p>Cashier: {detail.cashierName}</p>
          {detail.customerName && <p>Customer: {detail.customerName}</p>}
          <p>Status: {detail.status}</p>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-2 py-3 font-medium">
                  Item
                </th>
                <th scope="col" className="px-2 py-3 text-right font-medium">
                  Qty
                </th>
                <th scope="col" className="px-2 py-3 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.items.map((item) => (
                <tr key={item.productId}>
                  <td className="px-2 py-3">{item.productName}</td>
                  <td className="px-2 py-3 text-right">{item.quantity}</td>
                  <td className="px-2 py-3 text-right">{formatMoney(item.lineTotal, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto mt-6 max-w-xs space-y-2 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatMoney(detail.subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Discount</dt>
            <dd>{formatMoney(detail.discountTotal, currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{detail.taxName}</dt>
            <dd>{formatMoney(detail.taxTotal, currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatMoney(detail.total, currency)}</dd>
          </div>
        </dl>

        <div className="mt-6 border-t border-slate-200 pt-4 text-sm">
          <h2 className="font-semibold text-navy-900">Payment</h2>
          {detail.payments.map((payment) => (
            <p key={payment.method} className="mt-1 text-slate-600">
              {PAYMENT_LABEL[payment.method]}: {formatMoney(payment.amount, currency)}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
