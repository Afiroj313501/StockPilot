import { LogOut, Menu, Package, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useActiveMembership, useLogout, useMe } from '../../features/auth/hooks';
import { hasRole, NAV_ITEMS } from '../../features/navigation';
import { useSettings } from '../../features/settings/hooks';
import type { Role } from '../../types/api';
import { Button } from '../ui/Button';

const ROLE_LABEL: Record<Role, string> = { OWNER: 'Owner', MANAGER: 'Manager', CASHIER: 'Cashier' };
const Brand = () => (
  <div className="flex items-center gap-2 font-bold text-navy-900">
    <Package className="h-6 w-6 text-blue-600" aria-hidden="true" />
    StockPilot AI
  </div>
);

export function AppShell() {
  const me = useMe();
  const membership = useActiveMembership();
  const settings = useSettings();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  if (!me.data || !membership) return null;
  const items = NAV_ITEMS.filter((item) => hasRole(membership.role, item.minRole));
  const storeName = settings.data?.storeName ?? membership.storeName;
  return (
    <div className="min-h-screen md:flex">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <Brand />
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg p-2 text-navy-900"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      <aside
        id="sidebar"
        className={`${open ? 'flex' : 'hidden'} flex-col border-b border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:border-r`}
      >
        <div className="hidden px-5 py-5 md:block">
          <Brand />
        </div>
        <nav aria-label="Main" className="flex-1 space-y-1 px-3 py-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'}`
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-semibold text-navy-900">{me.data.user.name}</p>
          <p className="truncate text-xs text-slate-500">
            {ROLE_LABEL[membership.role]} · {storeName}
          </p>
          {logout.isError && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              Could not sign out. Try again.
            </p>
          )}
          <Button
            variant="secondary"
            className="mt-3 w-full"
            loading={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-8 md:px-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
