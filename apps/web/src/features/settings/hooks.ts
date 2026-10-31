import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { StoreSettings, UpdateSettingsPayload } from '../../types/api';

const SETTINGS_KEY = ['settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api<StoreSettings>('/settings'),
    retry: false,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsPayload) =>
      api<StoreSettings>('/settings', { method: 'PATCH', body }),
    onSuccess: (settings) => {
      queryClient.setQueryData(SETTINGS_KEY, settings);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
