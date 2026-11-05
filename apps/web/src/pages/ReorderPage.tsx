import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import { CreateDraftDialog } from '../features/forecasting/CreateDraftDialog';
import { useDecision, useReorder } from '../features/forecasting/hooks';
import { useSettings } from '../features/settings/hooks';
import type { Confidence, ReorderItem, ReorderParams, Urgency } from '../types/api';

const DEFAULTS: ReorderParams = { windowDays: 30, safetyDays: 3, coverageDays: 14 };
const FIELDS: {
  key: keyof ReorderParams;
  label: string;
  hint: string;
  min: number;
  max: number;
}[] = [
  { key: 'windowDays', label: 'Look back (days)', hint: '7 to 180', min: 7, max: 180 },
  { key: 'safetyDays', label: 'Safety stock (days of sales)', hint: '0 to 60', min: 0, max: 60 },
  { key: 'coverageDays', label: 'Cover after delivery (days)', hint: '0 to 180', min: 0, max: 180 },
];
const URGENCY: Record<Urgency, { label: string; style: string }> = {
  CRITICAL: {
    label: 'Critical: runs out before a new order arrives',
    style: 'bg-red-100 text-red-800',
  },
  HIGH: { label: 'Order soon', style: 'bg-amber-100 text-amber-800' },
  NONE: { label: 'Needs review', style: 'bg-slate-100 text-slate-700' },
};
const CONFIDENCE: Record<Confidence, string> = {
  INSUFFICIENT: 'Not enough history',
  LOW: 'Low confidence',
  MEDIUM: 'Medium confidence',
  HIGH: 'High confidence',
};

function ParamsBar({
  params,
  onApply,
}: {
  params: ReorderParams;
  onApply: (p: ReorderParams) => void;
}) {
  const [text, setText] = useState({
    windowDays: String(params.windowDays),
    safetyDays: String(params.safetyDays),
    coverageDays: String(params.coverageDays),
  });
  const [error, setError] = useState<string | null>(null);
  const apply = (e: FormEvent) => {
    e.preventDefault();
    const next = { ...DEFAULTS };
    for (const f of FIELDS) {
      const v = text[f.key].trim();
      if (!/^\d+$/.test(v) || Number(v) < f.min || Number(v) > f.max) {
        setError(`${f.label}: enter a whole number from ${f.min} to ${f.max}.`);
        return;
      }
      next[f.key] = Number(v);
    }
    setError(null);
    onApply(next);
  };
  return (
    <form onSubmit={apply} noValidate className="flex flex-wrap items-end gap-3">
      {FIELDS.map((f) => (
        <div key={f.key}>
          <label htmlFor={f.key} className="block text-sm font-medium text-navy-900">
            {f.label}
          </label>
          <input
            id={f.key}
            inputMode="numeric"
            value={text[f.key]}
            onChange={(e) => setText((prev) => ({ ...prev, [f.key]: e.target.value }))}
            className="mt-1 w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <p className="mt-1 text-xs text-slate-500">{f.hint}</p>
        </div>
      ))}
      <Button type="submit" className="mb-5">
        Apply
      </Button>
      {error && (
        <p role="alert" className="mb-5 text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

function Fact({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-base font-semibold text-navy-900">{value}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  );
}

function Card({
  item,
  currency,
  busy,
  onCreate,
  onDecision,
}: {
  item: ReorderItem;
  currency: string;
  busy: boolean;
  onCreate: () => void;
  onDecision: (kind: 'dismiss' | 'review') => void;
}) {
  const reorder = item.status === 'REORDER';
  const urgency = reorder ? URGENCY[item.urgency] : URGENCY.NONE;
  const handled = item.reviewState;
  return (
    <li className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-navy-900">{item.name}</h3>
          <p className="text-xs text-slate-500">{item.sku}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${urgency.style}`}>
            {urgency.label}
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            {CONFIDENCE[item.confidence]}
          </span>
        </div>
      </div>
      {reorder ? (
        <p className="mt-3 text-sm text-slate-700">
          Suggested order:{' '}
          <strong className="text-navy-900">{item.recommendedQuantity} unit(s)</strong>
          {item.estimatedCost ? ` (about ${formatMoney(item.estimatedCost, currency)})` : ''}.
        </p>
      ) : (
        <p className="mt-3 text-sm text-slate-700">
          There is not enough sales history to forecast, so no quantity is suggested. Stock is at or
          below the low-stock threshold ({item.inputs.lowStockThreshold}), so check it by hand.
        </p>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Fact
          label="In stock"
          value={item.currentStock}
          hint={item.daysOfCover ? `${item.daysOfCover} days of cover` : undefined}
        />
        <Fact
          label="Incoming (approved)"
          value={item.incomingStock}
          hint={
            item.pendingOrderQuantity
              ? `${item.pendingOrderQuantity} on draft or submitted orders`
              : undefined
          }
        />
        <Fact
          label="Sales per day"
          value={item.averageDailyDemand}
          hint={`${item.inputs.eligibleUnits} units in ${item.inputs.observedDays} days`}
        />
        <Fact
          label="Lead time"
          value={`${item.leadTimeDays} days`}
          hint={item.supplier ? item.supplier.name : 'Store default'}
        />
        <Fact
          label="Reorder point"
          value={item.reorderPoint}
          hint={`${item.leadTimeDemand} lead time + ${item.safetyStock} safety`}
        />
        <Fact
          label="Order up to"
          value={item.orderUpToLevel}
          hint={`${item.coverageStock} for ${item.coverageDays} days of cover`}
        />
      </dl>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer font-medium text-blue-600">
          How was this calculated?
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
          {item.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-slate-500">
          History: {item.inputs.windowStart} to {item.inputs.windowEnd}. Sales minus returns; draft
          and submitted orders are not counted as incoming.
        </p>
      </details>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {handled ? (
          <p className="text-sm text-slate-600">
            {handled.status === 'ORDERED'
              ? 'A draft order was created.'
              : handled.status === 'DISMISSED'
                ? 'Dismissed.'
                : 'Marked as reviewed.'}{' '}
            {handled.purchaseOrderId && (
              <Link
                to={`/purchases/${handled.purchaseOrderId}`}
                className="font-medium text-blue-600 hover:underline"
              >
                Open the order
              </Link>
            )}
          </p>
        ) : (
          <>
            {reorder && <Button onClick={onCreate}>Create draft order</Button>}
            <Button variant="secondary" disabled={busy} onClick={() => onDecision('review')}>
              Mark as reviewed
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => onDecision('dismiss')}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export function ReorderPage() {
  const settings = useSettings();
  const currency = settings.data?.currency ?? 'USD';
  const [params, setParams] = useState<ReorderParams>(DEFAULTS);
  const [showHandled, setShowHandled] = useState(false);
  const [drafting, setDrafting] = useState<ReorderItem | null>(null);
  const reorder = useReorder(params, showHandled);
  const decision = useDecision();
  const decisionError =
    decision.error instanceof ApiError
      ? decision.error.message
      : decision.isError
        ? 'Something went wrong.'
        : null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">Reorder planner</h1>
        <p className="mt-1 text-sm text-slate-600">
          Suggestions are calculated from your own sales history, supplier lead times and incoming
          orders. Every number can be traced in "How was this calculated?". Creating a draft order
          sends nothing to a supplier.
        </p>
      </div>
      <ParamsBar params={params} onApply={setParams} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showHandled}
          onChange={(e) => setShowHandled(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
        />
        Also show items I dismissed, reviewed or already ordered
      </label>
      {decisionError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {decisionError}
        </div>
      )}
      {reorder.isPending ? (
        <p role="status" className="text-slate-500">
          Calculating suggestions…
        </p>
      ) : reorder.isError ? (
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {reorder.error instanceof ApiError
            ? reorder.error.message
            : 'Could not load the suggestions.'}
          <Button variant="secondary" className="ml-3" onClick={() => void reorder.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <p role="status" className="text-sm text-slate-700">
            {reorder.data.counts.evaluated} product(s) checked:{' '}
            <strong>{reorder.data.counts.reorder}</strong> to reorder,{' '}
            <strong>{reorder.data.counts.insufficientLowStock}</strong> low on stock with too little
            history, {reorder.data.counts.handled} handled. Dates use {reorder.data.timeZone}.
          </p>
          {reorder.data.items.length === 0 ? (
            <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200">
              <p className="font-medium text-navy-900">Nothing needs reordering right now.</p>
              <p className="mt-1 text-sm text-slate-600">
                New products need at least 7 days and 3 sales before the planner can forecast them.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {reorder.data.items.map((item) => (
                <Card
                  key={item.productId}
                  item={item}
                  currency={currency}
                  busy={decision.isPending && decision.variables?.productId === item.productId}
                  onCreate={() => setDrafting(item)}
                  onDecision={(kind) =>
                    decision.mutate({ productId: item.productId, kind, params })
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
      <CreateDraftDialog
        item={drafting}
        params={params}
        currency={currency}
        onClose={() => setDrafting(null)}
      />
    </div>
  );
}
