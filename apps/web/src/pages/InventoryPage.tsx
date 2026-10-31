import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Pagination } from '../components/ui/Pagination';
import { AdjustStockDialog, type StockTarget } from '../features/inventory/AdjustStockDialog';
import { useLowStock, useMovements } from '../features/inventory/hooks';
import { MOVEMENT_LABEL } from '../features/inventory/labels';
import { useSettings } from '../features/settings/hooks';
import { formatDateTime } from '../lib/format';
export function InventoryPage() {
  const settings = useSettings();
  const low = useLowStock();
  const [page, setPage] = useState(1);
  const movements = useMovements(page);
  const [target, setTarget] = useState<StockTarget | null>(null);
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <h2 className="mt-5 text-lg font-semibold">Low stock</h2>
        {low.isPending ? (
          <p role="status">Loading…</p>
        ) : low.isError ? (
          <p role="alert" className="text-red-700">
            Could not load low-stock products.
          </p>
        ) : low.data.items.length === 0 ? (
          <p className="mt-3 rounded-xl bg-white p-6 text-slate-600 shadow-sm">
            Nothing is running low.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">In stock</th>
                  <th className="px-4 py-3 text-right">Threshold</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {low.data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <strong>{item.name}</strong>
                      <div className="text-xs text-slate-500">{item.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-right">{item.stockQuantity}</td>
                    <td className="px-4 py-3 text-right">{item.threshold}</td>
                    <td className="px-4 py-3">
                      <button className="text-blue-600" onClick={() => setTarget(item)}>
                        Adjust stock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Movement history</h2>
        {movements.isPending ? (
          <p role="status">Loading…</p>
        ) : movements.isError ? (
          <p role="alert" className="text-red-700">
            Could not load movement history.
          </p>
        ) : movements.data.total === 0 ? (
          <p className="rounded-xl bg-white p-6 text-slate-600 shadow-sm">
            No stock movements yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Change</th>
                  <th className="px-4 py-3 text-right">Before → after</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {movements.data.items.map((movement) => (
                  <tr key={movement.id}>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateTime(movement.createdAt, settings.data?.timeZone ?? 'UTC')}
                    </td>
                    <td className="px-4 py-3">
                      {movement.productName}
                      <div className="text-xs text-slate-500">{movement.productSku}</div>
                    </td>
                    <td className="px-4 py-3">{MOVEMENT_LABEL[movement.type]}</td>
                    <td
                      className={`px-4 py-3 text-right ${movement.quantityChange < 0 ? 'text-red-700' : 'text-green-700'}`}
                    >
                      {movement.quantityChange > 0 ? '+' : ''}
                      {movement.quantityChange}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {movement.quantityBefore} → {movement.quantityAfter}
                    </td>
                    <td className="px-4 py-3">{movement.reason ?? '—'}</td>
                    <td className="px-4 py-3">{movement.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {movements.data && (
          <Pagination
            page={movements.data.page}
            totalPages={movements.data.totalPages}
            total={movements.data.total}
            onPage={setPage}
          />
        )}
      </section>
      <AdjustStockDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
