import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../../lib/api';
import type { Account } from '../../types/api';
import type { LoginValues, RegisterValues } from './schemas';

const ME_KEY = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<Account | null> => {
      try {
        return await api<Account>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: LoginValues) =>
      api<Account>('/auth/login', { method: 'POST', body: values }),
    onSuccess: (account) => queryClient.setQueryData(ME_KEY, account),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: RegisterValues) =>
      api<Account>('/auth/register', { method: 'POST', body: values }),
    onSuccess: (account) => queryClient.setQueryData(ME_KEY, account),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
      queryClient.setQueryData(ME_KEY, null);
    },
  });
}
