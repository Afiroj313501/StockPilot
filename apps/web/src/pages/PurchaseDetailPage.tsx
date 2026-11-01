import { ArrowLeft } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Modal } from '../components/ui/Modal';
import { TextField } from '../components/ui/TextField';
import { useActiveMembership } from '../features/auth/hooks';
import { usePurchase, usePurchaseAction } from '../features/purchases/hooks';
import { ReceiveDialog } from '../features/purchases/ReceiveDialog';
import { StatusBadge } from '../features/purchases/status';
import { useSettings } from '../features/settings/hooks';
import { ApiError } from '../lib/api';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';

type Confirm = 'submit' | 'approve';

const CONFIRM_TEXT: Record<Confirm, { title: string; message: string; label: string }> = {
  submit: {
    title: 'Submit for approval?',
    message:
      'Once submitted, the order can no longer be edited. The owner approves it before stock can be received.',
    label: 'Submit',
  },
  approve: {
    title: 'Approve this order?',
    message: 'After approval, stock can be received against it.',
    label: 'Approve',
  },
};

function CancelForm({
  loading,
  onClose,
  onConfirm,
}: {
  loading: boolean;
  onClose: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length > 300) return setError('Use at most 300 characters');
    onConfirm(reason.trim() === '' ? null : reason.trim());
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">
        A cancelled order cannot be reopened. Create a new order if you still need the goods.
      </p>
      <TextField
        label="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={error ?? undefined}
      />
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          Keep order
        </Button>
        <Button type="submit" loading={loading}>
          Cancel order
        </Button>
      </div>
    </form>
  );
}

export function PurchaseDetailPage() {
  const { id } = useParams();
  const order = usePurchase(id);
  const membership = useActiveMembership();
  const settings = useSettings();
  const action = usePurchaseAction();
  const [confirming, setConfirming] = useState<Confirm | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const currency = settings.data?.currency ?? 'USD';
  const timeZone = settings.data?.timeZone ?? 'UTC';
  const actionError =
    action.error instanceof ApiError
      ? action.error.message
      : action.isError
        ? 'Something went wrong.'
        : null;

  const back = (
    <Link
      to="/purchases"
      className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Purchase orders
    </Link>
  );

  if (order.isPending) {
    return (
      <p role="status" className="text-slate-500">
        Loading order…
      </p>
    );
  }
  if (order.isError || !order.data) {
    return (
      <div>
        {back}
        <div role="alert" className="mt-3 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Order not found, or it could not be loaded.
        </div>
      </div>
    );
  }

  const o = order.data;
  const isOwner = membership?.role === 'OWNER';
  const closeConfirm = () => {
    setConfirming(null);
    action.reset();
  };
  const closeCancel = () => {
    setCancelling(false);
    action.reset();
  };

  return (
    <div className="space-y-8">
      <div>
        {back}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-navy-900">
            {o.reference} <StatusBadge status={o.status} />
          </h1>
          <div className="flex flex-wrap gap-2">
            {o.status === 'DRAFT' && (
              <>
                <Link
                  to={`/purchases/${o.id}/edit`}
                  className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-navy-900 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50"
                >
                  Edit
                </Link>
                <Button onClick={() => setConfirming('submit')}>Submit for approval</Button>
              </>
            )}
            {o.status === 'SUBMITTED' && isOwner && (
              <Button onClick={() => setConfirming('approve')}>Approve</Button>
            )}
            {(o.status === 'APPROVED' || o.status === 'PARTIALLY_RECEIVED') && (
              <Button onClick={() => setReceiving(true)}>Receive stock</Button>
            )}
            {(o.status === 'DRAFT' || o.status === 'SUBMITTED' || o.status === 'APPROVED') && (
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                Cancel order
              </Button>
            )}
          </div>
        </div>
        {o.status === 'SUBMITTED' && !isOwner && (
          <p className="mt-2 text-sm text-slate-600">
            Waiting for the owner to approve this order.
          </p>
        )}
      </div>

      <dl className="grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-slate-500">Supplier</dt>
        <dd>{o.supplierName}</dd>
        <dt className="text-slate-500">Expected</dt>
        <dd>{o.expectedDate ? formatDate(o.expectedDate) : '—'}</dd>
        <dt className="text-slate-500">Created</dt>
        <dd>
          {formatDateTime(o.createdAt, timeZone)} by {o.createdByName}
        </dd>
        {o.submittedAt && (
          <>
            <dt className="text-slate-500">Submitted</dt>
            <dd>{formatDateTime(o.submittedAt, timeZone)}</dd>
          </>
        )}
        {o.approvedAt && (
          <>
            <dt className="text-slate-500">Approved</dt>
            <dd>
              {formatDateTime(o.approvedAt, timeZone)}
              {o.approvedByName ? ` by ${o.approvedByName}` : ''}
            </dd>
          </>
        )}
        {o.cancelledAt && (
          <>
            <dt className="text-slate-500">Cancelled</dt>
            <dd>
              {formatDateTime(o.cancelledAt, timeZone)}
              {o.cancelReason ? ` · ${o.cancelReason}` : ''}
            </dd>
          </>
        )}
        {o.notes && (
          <>
            <dt className="text-slate-500">Notes</dt>
            <dd>{o.notes}</dd>
          </>
        )}
      </dl>

      <section aria-labelledby="lines-heading">
        <h2 id="lines-heading" className="mb-3 text-lg font-semibold text-navy-900">
          Lines
        </h2>
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Product
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Ordered
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Received
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Remaining
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Unit cost
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Line total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {o.items.map((i) => (
                <tr key={i.productId}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-navy-900">{i.productName}</div>
                    <div className="text-xs text-slate-500">{i.productSku}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{i.quantityOrdered}</td>
                  <td className="px-4 py-3 text-right">{i.quantityReceived}</td>
                  <td className="px-4 py-3 text-right">{i.quantityRemaining}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(i.unitCost, currency)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(i.lineTotal, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200">
                <th scope="row" colSpan={5} className="px-4 py-3 text-right font-medium">
                  Total
                </th>
                <td className="px-4 py-3 text-right font-semibold text-navy-900">
                  {formatMoney(o.total, currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section aria-labelledby="receipts-heading">
        <h2 id="receipts-heading" className="mb-3 text-lg font-semibold text-navy-900">
          Deliveries received
        </h2>
        {o.receipts.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
            Nothing received yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {o.receipts.map((r) => (
              <li key={r.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm font-medium text-navy-900">
                  {formatDateTime(r.receivedAt, timeZone)} · {r.receivedByName}
                </p>
                {r.note && <p className="text-sm text-slate-600">{r.note}</p>}
                <ul className="mt-2 text-sm text-slate-700">
                  {r.items.map((i) => (
                    <li key={i.productId}>
                      {i.quantity} × {i.productName} ({i.productSku}) at{' '}
                      {formatMoney(i.unitCost, currency)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? CONFIRM_TEXT[confirming].title : ''}
        message={confirming ? CONFIRM_TEXT[confirming].message : ''}
        confirmLabel={confirming ? CONFIRM_TEXT[confirming].label : ''}
        loading={action.isPending}
        error={actionError}
        onCancel={closeConfirm}
        onConfirm={() => {
          if (!confirming) return;
          action.mutate({ id: o.id, action: confirming }, { onSuccess: closeConfirm });
        }}
      />

      <Modal open={cancelling} onClose={closeCancel} title="Cancel this order?">
        {cancelling && (
          <>
            {actionError && (
              <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {actionError}
              </div>
            )}
            <CancelForm
              loading={action.isPending}
              onClose={closeCancel}
              onConfirm={(reason) =>
                action.mutate(
                  { id: o.id, action: 'cancel', body: { reason } },
                  { onSuccess: closeCancel },
                )
              }
            />
          </>
        )}
      </Modal>

      <ReceiveDialog order={o} open={receiving} onClose={() => setReceiving(false)} />
    </div>
  );
}
