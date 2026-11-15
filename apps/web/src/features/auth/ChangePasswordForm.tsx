import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import { applyApiError } from '../../lib/forms';
import { useChangePassword } from './hooks';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(72),
    newPassword: z.string().min(10, 'Use at least 10 characters').max(72),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match',
  });
type Values = z.infer<typeof schema>;

export function ChangePasswordForm({
  onDone,
  submitLabel = 'Change password',
}: {
  onDone: () => void;
  submitLabel?: string;
}) {
  const change = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    change.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      {
        onSuccess: () => {
          reset();
          onDone();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'INVALID_CURRENT_PASSWORD')
            setError('currentPassword', { message: err.message });
          else if (err instanceof ApiError && err.code === 'PASSWORD_UNCHANGED')
            setError('newPassword', { message: err.message });
          else setFormError(applyApiError(err, setError));
        },
      },
    );
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}
      <TextField
        label="Current password"
        type="password"
        autoComplete="current-password"
        error={errors.currentPassword?.message}
        {...register('currentPassword')}
      />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters."
        error={errors.newPassword?.message}
        {...register('newPassword')}
      />
      <TextField
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
        error={errors.confirm?.message}
        {...register('confirm')}
      />
      <Button type="submit" loading={change.isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}
