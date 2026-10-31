import { Package } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useLogout, useMe } from '../features/auth/hooks';
import type { Role } from '../types/api';

const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', MANAGER: 'Manager', CASHIER: 'Cashier' };

export function HomePage() {
  const me = useMe();
  const logout = useLogout();
  const account = me.data;
  if (!account) return null;
  const membership = account.memberships[0];
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 font-bold">
            <Package className="h-6 w-6 text-blue-600" aria-hidden="true" />
            StockPilot AI
          </div>
          <Button variant="secondary" loading={logout.isPending} onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        {logout.isError && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            Could not sign out. Please try again.
          </div>
        )}
        <h1 className="text-2xl font-semibold">Welcome, {account.user.name}</h1>
        <dl className="mt-6 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-slate-500">Email</dt>
          <dd>{account.user.email}</dd>
          <dt className="text-slate-500">Store</dt>
          <dd>{membership?.storeName ?? '-'}</dd>
          <dt className="text-slate-500">Role</dt>
          <dd>{membership ? ROLE_LABEL[membership.role] : '-'}</dd>
        </dl>
      </main>
    </div>
  );
}
