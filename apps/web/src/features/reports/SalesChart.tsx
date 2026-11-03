import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '../../lib/format';
import type { SalesSummary } from '../../types/api';

interface Props {
  series: SalesSummary['series'];
  currency: string;
  title: string;
}

// The chart is only a drawing: the exact figures are in the table underneath, which is also
// what screen readers get.
export function SalesChart({ series, currency, title }: Props) {
  const data = series.map((s) => ({ bucket: s.bucket, net: Number(s.netSales) }));
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact' });

  return (
    <figure className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <figcaption className="mb-3 text-sm font-semibold text-navy-900">{title}</figcaption>
      <div
        className="h-64"
        role="img"
        aria-label={`${title}. ${data.length} periods. Exact values are in the table below the chart.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} minTickGap={16} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => compact.format(v)}
              width={48}
            />
            <Tooltip
              formatter={(value) => formatMoney(String(value), currency)}
              labelFormatter={(label) => String(label)}
            />
            <Bar dataKey="net" name="Net sales" fill="#2563eb" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-blue-600">View as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="min-w-full text-left">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Period
                </th>
                <th scope="col" className="py-1 pr-4 text-right font-medium">
                  Sales
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Net sales
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.bucket}>
                  <th scope="row" className="py-1 pr-4 font-normal">
                    {s.bucket}
                  </th>
                  <td className="py-1 pr-4 text-right">{s.salesCount}</td>
                  <td className="py-1 text-right">{formatMoney(s.netSales, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
