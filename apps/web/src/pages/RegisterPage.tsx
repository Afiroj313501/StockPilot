import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/ui/AuthLayout';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { useRegister } from '../features/auth/hooks';
import { registerSchema, type RegisterValues } from '../features/auth/schemas';
import { applyApiError } from '../lib/forms';

export function RegisterPage() {
  const registerAccount = useRegister();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    registerAccount.mutate(values, {
      onError: (error) => setFormError(applyApiError(error, setError)),
    });
  });

  return (
    <AuthLayout
      title="Create your store"
      subtitle="You will be the store owner and can add your team later."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-blue-600 hover:underline">
            Sign in
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
          label="Your name"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="Store name"
          error={errors.storeName?.message}
          {...register('storeName')}
        />
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
          autoComplete="new-password"
          hint="At least 10 characters."
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" loading={registerAccount.isPending} className="w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
