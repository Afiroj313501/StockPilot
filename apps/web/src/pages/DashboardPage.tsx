import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useAuthName } from './authName';
import { DateRangeBar } from '../features/reports/DateRangeBar';
import { useDashboard, type DateRange } from '../features/reports/hooks';
import { MetricCard } from '../features/reports/MetricCard';
import { SalesChart } from '../features/reports/SalesChart';
import { PAYMENT_LABEL } from '../features/sales/labels';
import { useSettings } from '../features/settings/hooks';
import { formatDateTime, formatMoney } from '../lib/format';

export function DashboardPage() {
  const name = useAuthName();
  const settings = useSettings();
  const [range, setRange] = useState<DateRange | null>(null);
  const dash = useDashboard(range);
  const currency = settings.data?.currency ?? 'USD';
  const m = (v: string) => formatMoney(v, currency);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">Welcome, {name}</h1>
        <div className="mt-4">
          <DateRangeBar period={dash.data?.period} onChange={setRange} />
        </div>
      </div>

      {dash.isPending ? (
        <p role="status" className="text-slate-500">
          Loading the dashboard…
        </p>
      ) : dash.isError ? (
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Could not load the dashboard.
          <Button variant="secondary" className="ml-3" onClick={() => void dash.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <DashboardBody data={dash.data} currency={currency} m={m} />
      )}
    </div>
  );
}

function DashboardBody({
  data,
  currency,
  m,
}: {
  data: NonNullable<ReturnType<typeof useDashboard>['data']>;
  currency: string;
  m: (v: string) => string;
}) {
  const t = data.summary.totals;
  const empty = t.salesCount === 0 && t.returnsCount === 0;

  return (
    <>
      {data.summary.warnings.zeroCostLines > 0 && (
        <div role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {data.summary.warnings.zeroCostLines} sold line(s) have a cost of 0, so gross profit may
          be overstated. Set a cost price on those products.
        </div>
      )}

      <section
        aria-label="Key figures for the selected period"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricCard label="Net sales" value={m(t.netSales)} hint="After refunds, excluding tax" />
        <MetricCard
          label="Transactions"
          value={t.salesCount}
          hint={`${t.returnsCount} return(s)`}
        />
        <MetricCard
          label="Gross profit (estimate)"
          value={m(t.grossProfit)}
          hint="Net sales minus cost of goods sold"
        />
        <MetricCard label="Refunds" value={m(t.refunds)} hint="Recorded in the period" />
      </section>

      <section
        aria-label="Stock and purchasing"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Link
          to="/inventory"
          className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <MetricCard
            label="Low-stock products"
            value={data.lowStock.total}
            hint="Open the inventory page"
          />
        </Link>
        <MetricCard
          label="Inventory value (cost)"
          value={m(data.inventory.costValue)}
          hint={`${data.inventory.units} units on hand`}
        />
        <Link
          to="/purchases"
          className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <MetricCard
            label="Orders awaiting approval"
            value={data.pendingPurchases.awaitingApproval}
            hint="Purchase orders"
          />
        </Link>
        <Link
          to="/purchases"
          className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <MetricCard
            label="Orders awaiting delivery"
            value={data.pendingPurchases.awaitingDelivery}
            hint="Approved or partly received"
          />
        </Link>
      </section>

      {empty ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <p className="font-medium text-navy-900">No sales in this period.</p>
          <p className="mt-1 text-sm text-slate-600">
            Try a different date range, or make a sale at the{' '}
            <Link to="/pos" className="font-medium text-blue-600 hover:underline">
              point of sale
            </Link>
            .
          </p>
        </div>
      ) : (
        <SalesChart series={data.summary.series} currency={currency} title="Net sales per day" />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="top-products">
          <h2 id="top-products" className="mb-3 text-lg font-semibold text-navy-900">
            Best sellers
          </h2>
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-slate-600">No products sold in this period.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Product
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Units
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Net revenue
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.topProducts.map((p) => (
                    <tr key={p.productId}>
                      <td className="px-4 py-3 font-medium text-navy-900">{p.name}</td>
                      <td className="px-4 py-3 text-right">{p.netUnits}</td>
                      <td className="px-4 py-3 text-right">{m(p.netRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="category-perf">
          <h2 id="category-perf" className="mb-3 text-lg font-semibold text-navy-900">
            Categories
          </h2>
          {data.categories.length === 0 ? (
            <p className="text-sm text-slate-600">No category sales in this period.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Category
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Net revenue
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Profit (est.)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.categories.map((c) => (
                    <tr key={c.categoryId ?? 'none'}>
                      <td className="px-4 py-3 font-medium text-navy-900">{c.name}</td>
                      <td className="px-4 py-3 text-right">{m(c.netRevenue)}</td>
                      <td className="px-4 py-3 text-right">{m(c.grossProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="recent-sales">
        <h2 id="recent-sales" className="mb-3 text-lg font-semibold text-navy-900">
          Recent transactions
        </h2>
        {data.recentSales.length === 0 ? (
          <p className="text-sm text-slate-600">No sales yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {data.recentSales.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <Link to={`/sales/${s.id}`} className="font-medium text-blue-600 hover:underline">
                  {s.reference}
                </Link>
                <span className="text-slate-600">
                  {formatDateTime(s.createdAt, data.period.timeZone)} · {s.cashierName} ·{' '}
                  {s.paymentMethod ? PAYMENT_LABEL[s.paymentMethod] : '—'}
                </span>
                <span className="font-medium text-navy-900">{formatMoney(s.total, currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
        <summary className="cursor-pointer font-medium text-navy-900">
          How these numbers are calculated
        </summary>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-700">
          <li>Dates and days use the store time zone ({data.period.timeZone}).</li>
          <li>
            Net sales = what customers paid, minus tax, minus refunds (also without tax). Refunds
            count on the day they were recorded.
          </li>
          <li>
            Cost of goods sold uses the cost saved on each sale. Items returned to stock reduce it;
            damaged returns do not.
          </li>
          <li>
            Gross profit is an estimate (net sales minus cost of goods sold). It is not audited
            accounting.
          </li>
          <li>
            Inventory value uses the average cost, or the cost price when no average exists yet.
          </li>
          <li>
            Amounts are shown in {currency}; sales are added up as recorded, with no currency
            conversion.
          </li>
        </ul>
      </details>
    </>
  );
}
