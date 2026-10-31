import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { LowStockResponse, MovementPayload, Paginated, StockMovement } from '../../types/api';
export function useMovements(page: number) {
  return useQuery({
    queryKey: ['inventory', 'movements', page],
    queryFn: () => api<Paginated<StockMovement>>(`/inventory/movements?page=${page}&pageSize=15`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}
export function useLowStock() {
  return useQuery({
    queryKey: ['inventory', 'low-stock'],
    queryFn: () => api<LowStockResponse>('/inventory/low-stock?limit=50'),
    retry: false,
  });
}
export function useRecordMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MovementPayload) =>
      api<StockMovement>('/inventory/movements', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}
