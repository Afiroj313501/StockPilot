import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { applyApiError } from '../../lib/forms';
import { currencyOptions, timeZoneOptions } from '../../lib/locale';
import { useUpdateSettings } from './hooks';
import { settingsFormSchema, toFormValues, toPayload, type SettingsFormValues } from './schemas';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <legend className="px-1 text-sm font-semibold text-navy-900">{title}</legend>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function StoreSettingsForm({
  initial,
  submitLabel,
  completeOnboarding = false,
}: {
  initial: SettingsFormValues;
  submitLabel: string;
  completeOnboarding?: boolean;
}) {
  const update = useUpdateSettings();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: initial,
  });
  const timeZones = useMemo(() => timeZoneOptions(initial.timeZone), [initial.timeZone]);
  const currencies = useMemo(() => currencyOptions(initial.currency), [initial.currency]);

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    setSaved(false);
    const body = completeOnboarding
      ? { ...toPayload(values), completeOnboarding: true as const }
      : toPayload(values);
    update.mutate(body, {
      onSuccess: (settings) => {
        reset(toFormValues(settings));
        setSaved(true);
      },
      onError: (error) => setFormError(applyApiError(error, setError)),
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {formError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}
      <Section title="Store details">
        <TextField
          label="Store name"
          error={errors.storeName?.message}
          {...register('storeName')}
        />
        <TextField
          label="Business category"
          hint="For example: Mini-mart, Electronics"
          error={errors.businessCategory?.message}
          {...register('businessCategory')}
        />
        <TextField label="Address" error={errors.address?.message} {...register('address')} />
        <TextField label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
        <TextField
          label="Contact email"
          type="email"
          error={errors.contactEmail?.message}
          {...register('contactEmail')}
        />
      </Section>
      <Section title="Regional settings">
        <SelectField label="Currency" error={errors.currency?.message} {...register('currency')}>
          {currencies.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Time zone"
          hint="Used for daily reports and date boundaries."
          error={errors.timeZone?.message}
          {...register('timeZone')}
        >
          {timeZones.map((timeZone) => (
            <option key={timeZone} value={timeZone}>
              {timeZone}
            </option>
          ))}
        </SelectField>
      </Section>
      <Section title="Tax">
        <TextField
          label="Tax name"
          hint="Shown on receipts, for example VAT or Sales tax."
          error={errors.taxName?.message}
          {...register('taxName')}
        />
        <TextField
          label="Tax rate (%)"
          type="number"
          step="0.01"
          inputMode="decimal"
          hint="Applies to new sales."
          error={errors.taxRatePercent?.message}
          {...register('taxRatePercent', { valueAsNumber: true })}
        />
        <label className="flex items-start gap-3 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
            {...register('taxInclusive')}
          />
          <span>
            <span className="font-medium text-navy-900">Prices already include tax</span>
            <span className="block text-slate-500">Leave unticked if tax is added on top.</span>
          </span>
        </label>
      </Section>
      <Section title="Inventory and receipts">
        <TextField
          label="Default low-stock threshold"
          type="number"
          min={0}
          error={errors.defaultLowStockThreshold?.message}
          {...register('defaultLowStockThreshold', { valueAsNumber: true })}
        />
        <TextField
          label="Default supplier lead time (days)"
          type="number"
          min={0}
          error={errors.defaultLeadTimeDays?.message}
          {...register('defaultLeadTimeDays', { valueAsNumber: true })}
        />
        <TextField
          label="Receipt footer"
          error={errors.receiptFooter?.message}
          {...register('receiptFooter')}
        />
        <label className="flex items-start gap-3 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
            {...register('allowNegativeStock')}
          />
          <span>
            <span className="font-medium text-navy-900">Allow selling below zero stock</span>
            <span className="block text-slate-500">Leave unticked to block unavailable sales.</span>
          </span>
        </label>
      </Section>
      <div className="flex items-center gap-4">
        <Button type="submit" loading={update.isPending}>
          {submitLabel}
        </Button>
        {saved && !completeOnboarding && (
          <p role="status" className="text-sm text-green-700">
            Settings saved.
          </p>
        )}
      </div>
    </form>
  );
}
