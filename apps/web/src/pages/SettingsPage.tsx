import { Button } from '../components/ui/Button';
import { useSettings } from '../features/settings/hooks';
import { StoreSettingsForm } from '../features/settings/StoreSettingsForm';
import { toFormValues } from '../features/settings/schemas';

export function SettingsPage() {
  const settings = useSettings();
  if (settings.isPending)
    return (
      <p role="status" className="text-slate-500">
        Loading settings...
      </p>
    );
  if (settings.isError)
    return (
      <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        Could not load settings.
        <Button variant="secondary" className="ml-3" onClick={() => void settings.refetch()}>
          Retry
        </Button>
      </div>
    );
  return (
    <div>
      <h1 className="text-2xl font-semibold text-navy-900">Store settings</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">
        Only the store owner can change these settings.
      </p>
      <StoreSettingsForm initial={toFormValues(settings.data)} submitLabel="Save changes" />
    </div>
  );
}
