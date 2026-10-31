import { Navigate, Outlet } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useMe } from '../features/auth/hooks';

function LoadingScreen() {
  return (
    <div role="status" className="grid min-h-screen place-items-center text-slate-500">
      Loading...
    </div>
  );
}

function ConnectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="grid min-h-screen place-items-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-navy-900">Cannot reach the server</h1>
        <p className="mt-2 text-sm text-slate-600">Make sure the API is running, then try again.</p>
        <Button className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

export function RequireAuth() {
  const me = useMe();
  if (me.isPending) return <LoadingScreen />;
  if (me.isError) return <ConnectionError onRetry={() => void me.refetch()} />;
  if (!me.data) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function PublicOnly() {
  const me = useMe();
  if (me.isPending) return <LoadingScreen />;
  if (me.isError) return <ConnectionError onRetry={() => void me.refetch()} />;
  if (me.data) return <Navigate to="/" replace />;
  return <Outlet />;
}
