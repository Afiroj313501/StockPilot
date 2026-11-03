import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { addDays, firstOfMonth } from '../../lib/dates';
import type { ReportPeriod } from '../../types/api';
import type { DateRange } from './hooks';

interface Props {
  period: ReportPeriod | undefined;
  onChange: (range: DateRange) => void;
}

const inputClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600';

export function DateRangeBar({ period, onChange }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Show the range the server actually used (it chooses the default).
  useEffect(() => {
    if (period) {
      setFrom(period.from);
      setTo(period.to);
    }
  }, [period?.from, period?.to]);

  const invalid = from === '' || to === '' || from > to;
  const today = period?.today;
  const presets: { label: string; range: DateRange }[] = today
    ? [
        { label: 'Today', range: { from: today, to: today } },
        { label: 'Last 7 days', range: { from: addDays(today, -6), to: today } },
        { label: 'Last 30 days', range: { from: addDays(today, -29), to: today } },
        { label: 'This month', range: { from: firstOfMonth(today), to: today } },
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="range-from" className="block text-sm font-medium text-navy-900">
            From
          </label>
          <input id="range-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label htmlFor="range-to" className="block text-sm font-medium text-navy-900">
            To
          </label>
          <input id="range-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} mt-1`} />
        </div>
        <Button disabled={invalid} onClick={() => onChange({ from, to })}>
          Apply
        </Button>
        {period && <span className="pb-2 text-xs text-slate-500">Dates are in {period.timeZone}.</span>}
      </div>
      {from !== '' && to !== '' && from > to && (
        <p role="alert" className="text-sm text-red-600">
          The start date must not be after the end date.
        </p>
      )}
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.range)}
              className="rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}