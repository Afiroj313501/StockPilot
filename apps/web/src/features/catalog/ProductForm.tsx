import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import { applyApiError } from '../../lib/forms';
import type { Category } from '../../types/api';
import { useCreateProduct, useUpdateProduct } from './hooks';
import { productFormSchema, toProductPayload, type ProductFormValues } from './schemas';

export function ProductForm({
  initial,
  categories,
  productId,
  stockQuantity,
}: {
  initial: ProductFormValues;
  categories: Category[];
  productId?: string;
  stockQuantity?: number;
}) {
  const navigate = useNavigate();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: initial,
  });
  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    const options = {
      onSuccess: () => navigate('/products'),
      onError: (error: unknown) => setFormError(applyApiError(error, setError)),
    };
    if (productId) update.mutate({ id: productId, body: toProductPayload(values) }, options);
    else create.mutate(toProductPayload(values), options);
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {formError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}
      <fieldset className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <legend className="font-semibold">Product details</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <TextField label="Name" error={errors.name?.message} {...register('name')} />
          <TextField label="SKU" error={errors.sku?.message} {...register('sku')} />
          <TextField
            label="Barcode (optional)"
            error={errors.barcode?.message}
            {...register('barcode')}
          />
          <SelectField
            label="Category"
            error={errors.categoryId?.message}
            {...register('categoryId')}
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <TextField label="Unit (optional)" error={errors.unit?.message} {...register('unit')} />
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium">Description</label>
            <textarea
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              rows={3}
              {...register('description')}
            />
          </div>
        </div>
      </fieldset>
      <fieldset className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <legend className="font-semibold">Pricing and stock</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <TextField
            label="Cost price"
            inputMode="decimal"
            error={errors.costPrice?.message}
            {...register('costPrice')}
          />
          <TextField
            label="Selling price"
            inputMode="decimal"
            error={errors.sellingPrice?.message}
            {...register('sellingPrice')}
          />
          <TextField
            label="Low-stock threshold (optional)"
            inputMode="numeric"
            error={errors.reorderThreshold?.message}
            {...register('reorderThreshold')}
          />
          <p className="text-sm text-slate-600">
            <strong>Current stock:</strong> {stockQuantity ?? 0}. Stock changes only through Adjust
            stock.
          </p>
        </div>
      </fieldset>
      <div className="flex gap-3">
        <Button type="submit" loading={create.isPending || update.isPending}>
          {productId ? 'Save changes' : 'Create product'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => navigate('/products')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
