import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Paginated, Supplier, SupplierPayload } from '../../types/api';

export interface SupplierFilters {
  search: string;
  status: 'active' | 'archived' | 'all';
  page: number;
}

export function useSuppliers(filters: SupplierFilters) {
  const params = new URLSearchParams({
    status: filters.status,
    page: String(filters.page),
    pageSize: '20',
  });
  if (filters.search) params.set('search', filters.search);
  return useQuery({
    queryKey: ['suppliers', 'list', filters],
    queryFn: () => api<Paginated<Supplier>>(`/suppliers?${params.toString()}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useSaveSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: Partial<SupplierPayload> & { isActive?: boolean };
    }) =>
      id
        ? api<Supplier>(`/suppliers/${id}`, { method: 'PATCH', body })
        : api<Supplier>('/suppliers', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

// Active suppliers for pickers (up to 100).
export function useSupplierOptions() {
  return useQuery({
    queryKey: ['suppliers', 'options'],
    queryFn: async () =>
      (await api<Paginated<Supplier>>('/suppliers?status=active&pageSize=100')).items,
    retry: false,
  });
}
