import { Package } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useActiveMembership } from '../features/auth/hooks';
import { useSettings } from '../features/settings/hooks';
import { StoreSettingsForm } from '../features/settings/StoreSettingsForm';
import { toFormValues } from '../features/settings/schemas';
import { browserTimeZone } from '../lib/locale';
import { ConnectionError, LoadingScreen } from '../routes/guards';

export function OnboardingPage() {
  const membership = useActiveMembership();
  const settings = useSettings();
  if (membership?.role !== 'OWNER') return <Navigate to="/" replace />;
  if (settings.isPending) return <LoadingScreen />;
  if (settings.isError) return <ConnectionError onRetry={() => void settings.refetch()} />;
  if (settings.data.onboardingCompletedAt) return <Navigate to="/" replace />;
  const initial = { ...toFormValues(settings.data), timeZone: browserTimeZone() };
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center gap-2 font-bold text-navy-900">
        <Package className="h-7 w-7 text-blue-600" />
        StockPilot AI
      </div>
      <h1 className="text-2xl font-semibold text-navy-900">Set up your store</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">
        These settings drive prices, tax and reports. You can change them later in Settings.
      </p>
      <StoreSettingsForm initial={initial} submitLabel="Finish setup" completeOnboarding />
    </main>
  );
}
