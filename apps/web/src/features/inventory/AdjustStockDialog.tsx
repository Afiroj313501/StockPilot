import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import type { MovementPayload } from '../../types/api';
import { useRecordMovement } from './hooks';
export interface StockTarget {
  id: string;
  name: string;
  sku: string;
  stockQuantity: number;
}
const schema = z
  .object({
    type: z.enum(['OPENING', 'ADJUSTMENT', 'DAMAGED', 'LOST', 'RECONCILIATION']),
    quantity: z.string().regex(/^-?\d+$/, 'Enter a whole number'),
    reason: z.string().max(300),
  })
  .superRefine((value, ctx) => {
    const number = Number(value.quantity);
    if (Math.abs(number) > 1_000_000)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Number is too large' });
    if (['OPENING', 'DAMAGED', 'LOST'].includes(value.type) && number < 1)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter at least 1' });
    if (value.type === 'ADJUSTMENT' && number === 0)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Cannot be zero' });
    if (value.type === 'ADJUSTMENT' && !value.reason.trim())
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Reason is required' });
    if (value.type === 'RECONCILIATION' && number < 0)
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Cannot be negative' });
  });
type Values = z.infer<typeof schema>;
export function AdjustStockDialog({
  target,
  onClose,
}: {
  target: StockTarget | null;
  onClose: () => void;
}) {
  return (
    <Modal open={target !== null} onClose={onClose} title="Adjust stock">
      {target && <AdjustForm target={target} onClose={onClose} />}
    </Modal>
  );
}
function AdjustForm({ target, onClose }: { target: StockTarget; onClose: () => void }) {
  const record = useRecordMovement();
  const [error, setErrorMessage] = useState<string | null>(null);
  const attempt = useRef<{ signature: string; key: string }>();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: {
      type: target.stockQuantity ? 'ADJUSTMENT' : 'OPENING',
      quantity: '',
      reason: '',
    },
    resolver: async (values) => {
      const result = schema.safeParse(values);
      return result.success
        ? { values: result.data, errors: {} }
        : {
            values: {},
            errors: Object.fromEntries(
              result.error.issues.map((issue) => [
                issue.path[0],
                { type: issue.code, message: issue.message },
              ]),
            ),
          };
    },
  });
  const type = watch('type');
  const quantity = Number(watch('quantity'));
  const preview =
    Number.isFinite(quantity) && watch('quantity') !== ''
      ? type === 'RECONCILIATION'
        ? quantity
        : target.stockQuantity + (type === 'DAMAGED' || type === 'LOST' ? -quantity : quantity)
      : null;
  const submit = handleSubmit((values) => {
    const signature = JSON.stringify([target.id, values]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    record.mutate(
      {
        productId: target.id,
        type: values.type,
        quantity: Number(values.quantity),
        reason: values.reason || null,
        idempotencyKey: attempt.current.key,
      },
      {
        onSuccess: onClose,
        onError: (reason) =>
          setErrorMessage(
            reason instanceof ApiError ? reason.message : 'Could not record movement.',
          ),
      },
    );
  });
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600">
        <strong>{target.name}</strong> ({target.sku}) · {target.stockQuantity} in stock
      </p>
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <SelectField label="What happened?" error={errors.type?.message} {...register('type')}>
        <option value="OPENING">Opening stock</option>
        <option value="ADJUSTMENT">Adjustment</option>
        <option value="DAMAGED">Damaged</option>
        <option value="LOST">Lost</option>
        <option value="RECONCILIATION">Stock count</option>
      </SelectField>
      <TextField
        label="Quantity"
        inputMode="numeric"
        error={errors.quantity?.message}
        {...register('quantity')}
      />
      <TextField
        label={type === 'ADJUSTMENT' ? 'Reason (required)' : 'Reason (optional)'}
        error={errors.reason?.message}
        {...register('reason')}
      />
      {preview !== null && (
        <p role="status" className="text-sm">
          New stock will be <strong>{preview}</strong>.
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={record.isPending}>
          Record movement
        </Button>
      </div>
    </form>
  );
}
