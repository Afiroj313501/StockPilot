import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import { applyApiError } from '../../lib/forms';
import type { Supplier } from '../../types/api';
import { useSaveSupplier } from './hooks';
import {
  emptySupplierForm,
  supplierFormSchema,
  toSupplierForm,
  toSupplierPayload,
  type SupplierFormValues,
} from './schemas';

export function SupplierForm({
  supplier,
  onClose,
}: {
  supplier: Supplier | null;
  onClose: () => void;
}) {
  const save = useSaveSupplier();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: supplier ? toSupplierForm(supplier) : emptySupplierForm,
  });
  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    save.mutate(
      { ...(supplier ? { id: supplier.id } : {}), body: toSupplierPayload(values) },
      {
        onSuccess: onClose,
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'SUPPLIER_EXISTS') {
            setError('name', { message: error.message });
          } else {
            setFormError(applyApiError(error, setError));
          }
        },
      },
    );
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </p>
      )}
      <TextField label="Business name" error={errors.name?.message} {...register('name')} />
      <TextField
        label="Contact person (optional)"
        error={errors.contactName?.message}
        {...register('contactName')}
      />
      <TextField
        label="Email (optional)"
        type="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <TextField
        label="Phone (optional)"
        type="tel"
        error={errors.phone?.message}
        {...register('phone')}
      />
      <TextField
        label="Address (optional)"
        error={errors.address?.message}
        {...register('address')}
      />
      <TextField
        label="Lead time in days (optional)"
        inputMode="numeric"
        error={errors.leadTimeDays?.message}
        {...register('leadTimeDays')}
      />
      <TextField label="Notes (optional)" error={errors.notes?.message} {...register('notes')} />
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {supplier ? 'Save changes' : 'Add supplier'}
        </Button>
      </div>
    </form>
  );
}
