import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type {
  Paginated,
  PurchaseDetail,
  PurchasePayload,
  PurchaseStatus,
  PurchaseSummary,
  ReceivePayload,
} from '../../types/api';

export interface PurchaseFilters {
  status: '' | PurchaseStatus;
  page: number;
}

export function usePurchases(filters: PurchaseFilters) {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: '20' });
  if (filters.status) params.set('status', filters.status);
  return useQuery({
    queryKey: ['purchases', 'list', filters],
    queryFn: () => api<Paginated<PurchaseSummary>>(`/purchases?${params.toString()}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function usePurchase(id: string | undefined) {
  return useQuery({
    queryKey: ['purchases', 'detail', id],
    queryFn: () => api<PurchaseDetail>(`/purchases/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PurchasePayload) =>
      api<PurchaseDetail>('/purchases', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['purchases'] }),
  });
}

export function useUpdatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<PurchasePayload> }) =>
      api<PurchaseDetail>(`/purchases/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['purchases'] }),
  });
}

export function usePurchaseAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string;
      action: 'submit' | 'approve' | 'cancel';
      body?: unknown;
    }) =>
      api<PurchaseDetail>(
        `/purchases/${id}/${action}`,
        body === undefined ? { method: 'POST' } : { method: 'POST', body },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['purchases'] }),
  });
}

export function useReceivePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReceivePayload }) =>
      api<PurchaseDetail>(`/purchases/${id}/receive`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchases'] });
      void qc.invalidateQueries({ queryKey: ['products'] }); // stock changed
      void qc.invalidateQueries({ queryKey: ['inventory'] }); // new ledger rows
    },
  });
}
