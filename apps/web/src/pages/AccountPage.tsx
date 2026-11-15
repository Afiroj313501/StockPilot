import { useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { ChangePasswordForm } from '../features/auth/ChangePasswordForm';
import { useActiveMembership, useMe, useUpdateProfile } from '../features/auth/hooks';
import { ApiError } from '../lib/api';
import type { Role } from '../types/api';

const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', MANAGER: 'Manager', CASHIER: 'Cashier' };

export function AccountPage() {
  const me = useMe();
  const membership = useActiveMembership();
  const update = useUpdateProfile();
  const [name, setName] = useState(me.data?.user.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [changed, setChanged] = useState(false);
  if (!me.data) return null;
  const saveName = (e: FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return setError('Enter your name');
    if (value.length > 100) return setError('Use at most 100 characters');
    setError(null);
    update.mutate(value, {
      onSuccess: () => setSaved(true),
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'),
    });
  };
  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">My account</h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-slate-500">Email</dt>
          <dd>{me.data.user.email}</dd>
          <dt className="text-slate-500">Store</dt>
          <dd>{membership?.storeName ?? '—'}</dd>
          <dt className="text-slate-500">Role</dt>
          <dd>{membership ? ROLE_LABEL[membership.role] : '—'}</dd>
        </dl>
      </div>
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-navy-900">Your name</h2>
        <form onSubmit={saveName} noValidate className="mt-4 space-y-4">
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={error ?? undefined}
            autoComplete="name"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" loading={update.isPending}>
              Save name
            </Button>
            {saved && (
              <p role="status" className="text-sm text-green-700">
                Saved.
              </p>
            )}
          </div>
        </form>
      </section>
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-navy-900">Change password</h2>
        <p className="mt-1 text-sm text-slate-600">
          Changing your password signs you out on your other devices.
        </p>
        <div className="mt-4">
          <ChangePasswordForm onDone={() => setChanged(true)} />
          {changed && (
            <p role="status" className="mt-3 text-sm text-green-700">
              Your password was changed.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
