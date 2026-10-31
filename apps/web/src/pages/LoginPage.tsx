import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/ui/AuthLayout';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { useLogin } from '../features/auth/hooks';
import { loginSchema, type LoginValues } from '../features/auth/schemas';
import { applyApiError } from '../lib/forms';

export function LoginPage() {
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    login.mutate(values, { onError: (error) => setFormError(applyApiError(error, setError)) });
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Sign in to manage your store."
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-medium text-blue-600 hover:underline">
            Create a store account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && (
          <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {formError}
          </div>
        )}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" loading={login.isPending} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
