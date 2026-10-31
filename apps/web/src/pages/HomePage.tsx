import { useMe } from '../features/auth/hooks';
import { useSettings } from '../features/settings/hooks';

export function HomePage() {
  const me = useMe();
  const settings = useSettings();
  if (!me.data) return null;
  const current = settings.data;
  return (
    <div>
      <h1 className="text-2xl font-semibold text-navy-900">Welcome, {me.data.user.name}</h1>
      {current && (
        <dl className="mt-6 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-slate-500">Store</dt>
          <dd>{current.storeName}</dd>
          <dt className="text-slate-500">Currency</dt>
          <dd>{current.currency}</dd>
          <dt className="text-slate-500">Time zone</dt>
          <dd>{current.timeZone}</dd>
          <dt className="text-slate-500">Tax</dt>
          <dd>
            {current.taxName} {current.taxRatePercent}% (
            {current.taxInclusive ? 'included in prices' : 'added on top'})
          </dd>
        </dl>
      )}
      <p className="mt-8 text-sm text-slate-500">
        Sales, stock and reports will appear here as those features are built.
      </p>
    </div>
  );
}
