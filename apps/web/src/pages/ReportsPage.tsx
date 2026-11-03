import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { DateRangeBar } from '../features/reports/DateRangeBar';
import {
  exportHref,
  useCategoryReport,
  useInventoryReport,
  useProductReport,
  useSalesSummary,
  type DateRange,
} from '../features/reports/hooks';
import { SalesChart } from '../features/reports/SalesChart';
import { useSettings } from '../features/settings/hooks';
import { formatMoney } from '../lib/format';

type Report = 'sales' | 'products' | 'categories' | 'inventory';
type Group = 'day' | 'week' | 'month';

const REPORTS: { value: Report; label: string }[] = [
  { value: 'sales', label: 'Sales over time' },
  { value: 'products', label: 'Products' },
  { value: 'categories', label: 'Categories' },
  { value: 'inventory', label: 'Inventory valuation' },
];

const selectClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600';
const th = 'px-4 py-3 font-medium';

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      {children}
    </div>
  );
}

function Status({
  query,
  children,
}: {
  query: { isPending: boolean; isError: boolean; refetch: () => unknown };
  children: React.ReactNode;
}) {
  if (query.isPending) {
    return (
      <p role="status" className="text-slate-500">
        Loading…
      </p>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        Could not load this report.
        <Button variant="secondary" className="ml-3" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}

export function ReportsPage() {
  const settings = useSettings();
  const currency = settings.data?.currency ?? 'USD';
  const m = (v: string) => formatMoney(v, currency);

  const [report, setReport] = useState<Report>('sales');
  const [range, setRange] = useState<DateRange | null>(null);
  const [group, setGroup] = useState<Group>('day');
  const [sort, setSort] = useState<'revenue' | 'units' | 'profit'>('revenue');

  const summary = useSalesSummary(range, group);
  const products = useProductReport(range, sort);
  const categories = useCategoryReport(range);
  const inventory = useInventoryReport();

  const period = summary.data?.period ?? products.data?.period ?? categories.data?.period;
  const exportKind = report === 'inventory' ? 'inventory' : report;
  const href = exportHref(exportKind, range, report === 'sales' ? group : undefined);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-navy-900">Reports</h1>
        <a
          href={href}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-navy-900 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <Download className="h-4 w-4" aria-hidden="true" /> Download CSV
        </a>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="report-kind" className="block text-sm font-medium text-navy-900">
            Report
          </label>
          <select
            id="report-kind"
            value={report}
            onChange={(e) => setReport(e.target.value as Report)}
            className={`${selectClass} mt-1`}
          >
            {REPORTS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {report === 'sales' && (
          <div>
            <label htmlFor="report-group" className="block text-sm font-medium text-navy-900">
              Group by
            </label>
            <select
              id="report-group"
              value={group}
              onChange={(e) => setGroup(e.target.value as Group)}
              className={`${selectClass} mt-1`}
            >
              <option value="day">Day</option>
              <option value="week">Week (Monday start)</option>
              <option value="month">Month</option>
            </select>
          </div>
        )}
        {report === 'products' && (
          <div>
            <label htmlFor="report-sort" className="block text-sm font-medium text-navy-900">
              Rank by
            </label>
            <select
              id="report-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className={`${selectClass} mt-1`}
            >
              <option value="revenue">Net revenue</option>
              <option value="units">Units sold</option>
              <option value="profit">Gross profit</option>
            </select>
          </div>
        )}
      </div>

      {report !== 'inventory' && <DateRangeBar period={period} onChange={setRange} />}

      {report === 'sales' && (
        <Status query={summary}>
          {summary.data && (
            <div className="space-y-4">
              {summary.data.warnings.zeroCostLines > 0 && (
                <div role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  {summary.data.warnings.zeroCostLines} sold line(s) have a cost of 0, so profit may
                  be overstated.
                </div>
              )}
              <SalesChart
                series={summary.data.series}
                currency={currency}
                title={`Net sales per ${group}`}
              />
              <Panel>
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className={th}>
                        Period
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Sales
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Gross sales
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Discounts
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Tax
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Refunds
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Net sales
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Cost
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Profit (est.)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summary.data.series.map((r) => (
                      <tr key={r.bucket}>
                        <th scope="row" className="px-4 py-3 text-left font-normal">
                          {r.bucket}
                        </th>
                        <td className="px-4 py-3 text-right">{r.salesCount}</td>
                        <td className="px-4 py-3 text-right">{m(r.grossSales)}</td>
                        <td className="px-4 py-3 text-right">{m(r.discounts)}</td>
                        <td className="px-4 py-3 text-right">{m(r.taxCollected)}</td>
                        <td className="px-4 py-3 text-right">{m(r.refunds)}</td>
                        <td className="px-4 py-3 text-right">{m(r.netSales)}</td>
                        <td className="px-4 py-3 text-right">{m(r.cogs)}</td>
                        <td className="px-4 py-3 text-right">{m(r.grossProfit)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-200 font-semibold text-navy-900">
                    <tr>
                      <th scope="row" className="px-4 py-3 text-left">
                        Total
                      </th>
                      <td className="px-4 py-3 text-right">{summary.data.totals.salesCount}</td>
                      <td className="px-4 py-3 text-right">{m(summary.data.totals.grossSales)}</td>
                      <td className="px-4 py-3 text-right">{m(summary.data.totals.discounts)}</td>
                      <td className="px-4 py-3 text-right">
                        {m(summary.data.totals.taxCollected)}
                      </td>
                      <td className="px-4 py-3 text-right">{m(summary.data.totals.refunds)}</td>
                      <td className="px-4 py-3 text-right">{m(summary.data.totals.netSales)}</td>
                      <td className="px-4 py-3 text-right">{m(summary.data.totals.cogs)}</td>
                      <td className="px-4 py-3 text-right">{m(summary.data.totals.grossProfit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </Panel>
            </div>
          )}
        </Status>
      )}

      {report === 'products' && (
        <Status query={products}>
          {products.data &&
            (products.data.items.length === 0 ? (
              <p className="text-sm text-slate-600">No products sold or returned in this period.</p>
            ) : (
              <Panel>
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className={th}>
                        Product
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Sold
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Returned
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Net revenue
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Cost
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Profit (est.)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {products.data.items.map((p) => (
                      <tr key={p.productId}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-navy-900">{p.name}</div>
                          <div className="text-xs text-slate-500">{p.sku}</div>
                        </td>
                        <td className="px-4 py-3 text-right">{p.unitsSold}</td>
                        <td className="px-4 py-3 text-right">{p.unitsReturned}</td>
                        <td className="px-4 py-3 text-right">{m(p.netRevenue)}</td>
                        <td className="px-4 py-3 text-right">{m(p.cogs)}</td>
                        <td className="px-4 py-3 text-right">{m(p.grossProfit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            ))}
        </Status>
      )}

      {report === 'categories' && (
        <Status query={categories}>
          {categories.data &&
            (categories.data.items.length === 0 ? (
              <p className="text-sm text-slate-600">No category sales in this period.</p>
            ) : (
              <Panel>
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className={th}>
                        Category
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Sold
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Returned
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Net revenue
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Profit (est.)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {categories.data.items.map((c) => (
                      <tr key={c.categoryId ?? 'none'}>
                        <td className="px-4 py-3 font-medium text-navy-900">{c.name}</td>
                        <td className="px-4 py-3 text-right">{c.unitsSold}</td>
                        <td className="px-4 py-3 text-right">{c.unitsReturned}</td>
                        <td className="px-4 py-3 text-right">{m(c.netRevenue)}</td>
                        <td className="px-4 py-3 text-right">{m(c.grossProfit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            ))}
          <p className="mt-2 text-xs text-slate-500">
            Categories use each product's current category.
          </p>
        </Status>
      )}

      {report === 'inventory' && (
        <Status query={inventory}>
          {inventory.data && (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                {inventory.data.totals.units} units across {inventory.data.totals.productsWithStock}{' '}
                products · value at cost <strong>{m(inventory.data.totals.costValue)}</strong> · at
                selling price <strong>{m(inventory.data.totals.retailValue)}</strong>
              </p>
              <Panel>
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className={th}>
                        Category
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Units
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Cost value
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Retail value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventory.data.categories.map((c) => (
                      <tr key={c.categoryId ?? 'none'}>
                        <td className="px-4 py-3 font-medium text-navy-900">{c.name}</td>
                        <td className="px-4 py-3 text-right">{c.units}</td>
                        <td className="px-4 py-3 text-right">{m(c.costValue)}</td>
                        <td className="px-4 py-3 text-right">{m(c.retailValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <p className="text-xs text-slate-500">
                Valued at average cost, or the cost price when no average exists. Negative stock
                counts as zero.
              </p>
            </div>
          )}
        </Status>
      )}
    </div>
  );
}
