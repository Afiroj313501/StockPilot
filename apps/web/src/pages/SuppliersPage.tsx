import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Pagination } from '../components/ui/Pagination';
import { SupplierForm } from '../features/suppliers/SupplierForm';
import { useSaveSupplier, useSuppliers, type SupplierFilters } from '../features/suppliers/hooks';
import { ApiError } from '../lib/api';
import { useDebounce } from '../lib/useDebounce';
import type { Supplier } from '../types/api';

export function SuppliersPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search.trim(), 300);
  const [status, setStatus] = useState<SupplierFilters['status']>('active');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Supplier | null | undefined>();
  const [archiving, setArchiving] = useState<Supplier | null>(null);
  const suppliers = useSuppliers({ search: debouncedSearch, status, page });
  const save = useSaveSupplier();
  const archiveError = save.error instanceof ApiError ? save.error.message : null;
  const closeArchive = () => {
    setArchiving(null);
    save.reset();
  };
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-navy-900">Suppliers</h1>
        <Button onClick={() => setEditing(null)}>
          <Plus className="h-4 w-4" /> Add supplier
        </Button>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            aria-label="Search suppliers"
            placeholder="Search name, contact or email"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          aria-label="Supplier status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as SupplierFilters['status']);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </div>
      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <ul className="divide-y">
          {suppliers.data?.items.map((supplier) => (
            <li
              key={supplier.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
            >
              <div>
                <p className="font-medium">
                  {supplier.name}{' '}
                  {!supplier.isActive && <span className="text-xs text-slate-500">(Archived)</span>}
                </p>
                <p className="text-sm text-slate-500">
                  {supplier.contactName ?? supplier.email ?? supplier.phone ?? 'No contact details'}{' '}
                  · {supplier.orderCount} orders
                </p>
              </div>
              <div className="flex gap-3">
                <button className="text-blue-600" onClick={() => setEditing(supplier)}>
                  Edit
                </button>
                {supplier.isActive ? (
                  <button className="text-red-600" onClick={() => setArchiving(supplier)}>
                    Archive
                  </button>
                ) : (
                  <button
                    className="text-blue-600"
                    onClick={() => save.mutate({ id: supplier.id, body: { isActive: true } })}
                  >
                    Restore
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {suppliers.data && (
          <Pagination
            page={suppliers.data.page}
            totalPages={suppliers.data.totalPages}
            total={suppliers.data.total}
            onPage={setPage}
          />
        )}
      </div>
      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? 'Edit supplier' : 'Add supplier'}
      >
        {editing !== undefined && (
          <SupplierForm supplier={editing} onClose={() => setEditing(undefined)} />
        )}
      </Modal>
      <Modal open={archiving !== null} onClose={closeArchive} title="Archive supplier">
        <p className="text-sm text-slate-600">
          Archive {archiving?.name}? Existing purchase history will remain.
        </p>
        {archiveError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {archiveError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={closeArchive}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() =>
              archiving &&
              save.mutate(
                { id: archiving.id, body: { isActive: false } },
                { onSuccess: closeArchive },
              )
            }
          >
            Archive
          </Button>
        </div>
      </Modal>
    </div>
  );
}
