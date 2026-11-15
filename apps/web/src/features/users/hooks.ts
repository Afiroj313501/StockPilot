import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Member } from '../../types/api';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api<{ items: Member[] }>('/users')).items,
    retry: false,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: ['members'] });
  };
}

export function useCreateUser() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: {
      name: string;
      email: string;
      password: string;
      role: 'MANAGER' | 'CASHIER';
      requirePasswordChange: boolean;
    }) => api<{ userId: string; name: string; email: string }>('/users', { method: 'POST', body }),
    onSuccess: refresh,
  });
}

export function useChangeRole() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'MANAGER' | 'CASHIER' }) =>
      api<{ userId: string; role: string }>(`/users/${userId}/role`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: refresh,
  });
}

export function useSetUserActive() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      api<{ userId: string; name: string; isActive: boolean }>(`/users/${userId}/status`, {
        method: 'PATCH',
        body: { isActive },
      }),
    onSuccess: refresh,
  });
}

export function useResetPassword() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (userId: string) =>
      api<{ userId: string; name: string; temporaryPassword: string }>(
        `/users/${userId}/reset-password`,
        { method: 'POST' },
      ),
    onSuccess: refresh,
  });
}
