import { Link } from 'react-router-dom';
import { useActiveMembership } from '../features/auth/hooks';
import { hasRole } from '../features/navigation';
import { DashboardPage } from './DashboardPage';
import { useAuthName } from './authName';

export function HomePage() {
  const membership = useActiveMembership();
  const name = useAuthName();

  if (membership && hasRole(membership.role, 'MANAGER')) return <DashboardPage />;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-navy-900">Welcome, {name}</h1>
      <p className="mt-2 text-sm text-slate-600">Start a sale, or look at the sales you made.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/pos"
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          Open the point of sale
        </Link>
        <Link
          to="/sales"
          className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-navy-900 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50"
        >
          My sales
        </Link>
      </div>
    </div>
  );
}
