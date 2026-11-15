import { useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/ui/AuthLayout';
import { ChangePasswordForm } from '../features/auth/ChangePasswordForm';
import { useLogout, useMe } from '../features/auth/hooks';

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const logout = useLogout();
  const me = useMe();
  const forced = me.data?.user.mustChangePassword ?? false;
  return (
    <AuthLayout
      title="Choose a new password"
      subtitle={
        forced
          ? 'The store owner reset your password. Enter the temporary password you were given, then choose your own.'
          : 'Enter your current password, then choose a new one.'
      }
      footer={
        <button
          type="button"
          onClick={() => logout.mutate()}
          className="font-medium text-blue-600 hover:underline"
        >
          Sign out instead
        </button>
      }
    >
      <ChangePasswordForm
        submitLabel="Save new password"
        onDone={() => navigate('/', { replace: true })}
      />
    </AuthLayout>
  );
}
