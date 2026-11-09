import { useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Pagination } from '../components/ui/Pagination';
import {
  useAuditActions,
  useAuditLogs,
  useMembers,
  type AuditFilters,
} from '../features/audit/hooks';
import { useSettings } from '../features/settings/hooks';
import { formatDateTime } from '../lib/format';
import type { AuditActionInfo, Role } from '../types/api';

const CATEGORY_LABEL: Record<string, string> = {
  auth: 'Sign-in',
  user: 'Users',
  settings: 'Settings',
  category: 'Categories',
  product: 'Products',
  supplier: 'Suppliers',
  inventory: 'Stock',
  purchase: 'Purchasing',
  reorder: 'Reorder planner',
  sale: 'Sales',
  return: 'Returns',
  export: 'Exports',
};

const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', MANAGER: 'Manager', CASHIER: 'Cashier' };

const controlClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600';

function groupByCategory(actions: AuditActionInfo[]): [string, AuditActionInfo[]][] {
  const groups = new Map<string, AuditActionInfo[]>();
  for (const a of actions) groups.set(a.category, [...(groups.get(a.category) ?? []), a]);
  return [...groups.entries()];
}

export function AuditLogPage() {
  const settings = useSettings();
  const timeZone = settings.data?.timeZone ?? 'UTC';
  const actions = useAuditActions();
  const members = useMembers();

  const [action, setAction] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);

  const filters: AuditFilters = { action, actorUserId, from: applied.from, to: applied.to, page };
  const logs = useAuditLogs(filters);
  const groups = useMemo(() => groupByCategory(actions.data ?? []), [actions.data]);

  const dateError =
    (from === '') !== (to === '')
      ? 'Enter both dates, or clear both.'
      : from !== '' && from > to
        ? 'The start date must not be after the end date.'
        : null;
  const filtered = action !== '' || actorUserId !== '' || applied.from !== '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">
          A permanent record of important actions in your store. Entries cannot be edited or
          deleted. It shows what happened and who did it, never passwords or other secrets. Times
          use {timeZone}.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="audit-action" className="block text-sm font-medium text-navy-900">
            Event
          </label>
          <select
            id="audit-action"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            className={`${controlClass} mt-1`}
          >
            <option value="">All events</option>
            {groups.map(([category, items]) => (
              <optgroup key={category} label={CATEGORY_LABEL[category] ?? category}>
                <option value={category}>
                  All {(CATEGORY_LABEL[category] ?? category).toLowerCase()} events
                </option>
                {items.map((a) => (
                  <option key={a.action} value={a.action}>
                    {a.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-actor" className="block text-sm font-medium text-navy-900">
            Person
          </label>
          <select
            id="audit-actor"
            value={actorUserId}
            onChange={(e) => {
              setActorUserId(e.target.value);
              setPage(1);
            }}
            className={`${controlClass} mt-1`}
          >
            <option value="">Everyone</option>
            {(members.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} ({ROLE_LABEL[m.role]})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-from" className="block text-sm font-medium text-navy-900">
            From
          </label>
          <input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={`${controlClass} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="audit-to" className="block text-sm font-medium text-navy-900">
            To
          </label>
          <input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={`${controlClass} mt-1`}
          />
        </div>
        <Button
          variant="secondary"
          disabled={dateError !== null}
          onClick={() => {
            setApplied({ from, to });
            setPage(1);
          }}
        >
          Apply dates
        </Button>
      </div>
      {dateError && (
        <p role="alert" className="text-sm text-red-600">
          {dateError}
        </p>
      )}

      {logs.isPending ? (
        <p role="status" className="text-slate-500">
          Loading the audit log...
        </p>
      ) : logs.isError ? (
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Could not load the audit log.
          <Button variant="secondary" className="ml-3" onClick={() => void logs.refetch()}>
            Retry
          </Button>
        </div>
      ) : logs.data.total === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200">
          <p className="font-medium text-navy-900">
            {filtered ? 'No events match your filters.' : 'Nothing has been recorded yet.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  When
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Who
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  What happened
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.data.items.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3">
                    {formatDateTime(e.createdAt, timeZone)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-navy-900">{e.actorName}</div>
                    <div className="text-xs text-slate-500">{ROLE_LABEL[e.actorRole]}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-navy-900">{e.label}</div>
                    <div className="text-slate-700">{e.summary}</div>
                    <details className="mt-1 text-xs text-slate-500">
                      <summary className="cursor-pointer text-blue-600">Details</summary>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        <dt>Action</dt>
                        <dd>{e.action}</dd>
                        {e.resourceType && (
                          <>
                            <dt>Record</dt>
                            <dd>
                              {e.resourceType}
                              {e.resourceId ? ` ${e.resourceId}` : ''}
                            </dd>
                          </>
                        )}
                        {e.requestId && (
                          <>
                            <dt>Request</dt>
                            <dd>{e.requestId}</dd>
                          </>
                        )}
                        {e.metadata &&
                          Object.entries(e.metadata).map(([key, value]) => (
                            <div key={key} className="contents">
                              <dt>{key}</dt>
                              <dd>
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logs.data && (
        <Pagination
          page={logs.data.page}
          totalPages={logs.data.totalPages}
          total={logs.data.total}
          onPage={setPage}
        />
      )}
    </div>
  );
}
