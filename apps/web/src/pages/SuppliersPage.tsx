import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { useArchiveSupplier, useSaveSupplier, useSuppliers } from '../features/catalog/hooks';

export function SuppliersPage() {
  const suppliers = useSuppliers(true);
  const save = useSaveSupplier();
  const archive = useArchiveSupplier();
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    save.mutate(
      {
        id: editing,
        body: { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null },
      },
      {
        onSuccess: () => {
          setEditing(undefined);
          setName('');
          setPhone('');
          setEmail('');
        },
      },
    );
  };
  return (
    <div>
      <h1 className="text-2xl font-semibold">Suppliers</h1>
      <form onSubmit={submit} className="mt-6 grid max-w-3xl gap-3 md:grid-cols-4 md:items-end">
        <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <TextField label="Phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div className="flex gap-2">
          <Button loading={save.isPending}>{editing ? 'Save' : 'Add supplier'}</Button>
          {editing && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing(undefined);
                setName('');
                setPhone('');
                setEmail('');
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <ul className="divide-y">
          {suppliers.data?.map((supplier) => (
            <li key={supplier.id} className="flex items-center justify-between px-4 py-3">
              <span>
                <span className="font-medium">{supplier.name}</span>
                <span className="ml-3 text-sm text-slate-500">
                  {supplier.phone ?? supplier.email ?? 'No contact details'}
                </span>
                {!supplier.isActive && (
                  <span className="ml-3 text-xs text-slate-500">(Archived)</span>
                )}
              </span>
              {supplier.isActive && (
                <span className="flex gap-3">
                  <button
                    className="text-blue-600"
                    onClick={() => {
                      setEditing(supplier.id);
                      setName(supplier.name);
                      setPhone(supplier.phone ?? '');
                      setEmail(supplier.email ?? '');
                    }}
                  >
                    Edit
                  </button>
                  <button className="text-red-600" onClick={() => archive.mutate(supplier.id)}>
                    Archive
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
