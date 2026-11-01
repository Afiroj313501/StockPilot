import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { usePurchase } from '../features/purchases/hooks';
import { PurchaseForm } from '../features/purchases/PurchaseForm';

export function PurchaseFormPage() {
  const { id } = useParams();
  const order = usePurchase(id);

  if (id && order.isPending) {
    return (
      <p role="status" className="text-slate-500">
        Loading…
      </p>
    );
  }
  if (id && (order.isError || !order.data)) {
    return (
      <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        Order not found, or it could not be loaded.{' '}
        <Link to="/purchases" className="font-medium underline">
          Back to orders
        </Link>
      </div>
    );
  }
  if (id && order.data && order.data.status !== 'DRAFT') {
    return (
      <div role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
        Only draft orders can be edited.{' '}
        <Link to={`/purchases/${id}`} className="font-medium underline">
          Back to {order.data.reference}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        to={id ? `/purchases/${id}` : '/purchases'}
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{' '}
        {id ? 'Back to order' : 'Purchase orders'}
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold text-navy-900">
        {order.data ? `Edit ${order.data.reference}` : 'New purchase order'}
      </h1>
      <PurchaseForm {...(order.data ? { initial: order.data } : {})} />
    </div>
  );
}
