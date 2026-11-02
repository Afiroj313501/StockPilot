import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type {
  CreateReturnPayload,
  Paginated,
  ReturnPreview,
  ReturnSummary,
  SaleReturnable,
  SaleReturnDetail,
} from '../../types/api';

export function useSaleReturnable(saleId: string | undefined) {
  return useQuery({
    queryKey: ['returns', 'sale', saleId],
    queryFn: () => api<SaleReturnable>(`/returns/by-sale/${saleId}`),
    enabled: Boolean(saleId),
    retry: false,
  });
}

// The server works out the refund; the browser never calculates it.
export function useReturnPreview(saleId: string, items: { productId: string; quantity: number }[]) {
  return useQuery({
    queryKey: ['returns', 'preview', saleId, items],
    queryFn: () =>
      api<ReturnPreview>('/returns/preview', { method: 'POST', body: { saleId, items } }),
    enabled: items.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useCreateReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReturnPayload) =>
      api<SaleReturnDetail>('/returns', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['returns'] });
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['products'] }); // stock may have changed
      void qc.invalidateQueries({ queryKey: ['inventory'] }); // new ledger rows
    },
  });
}

export function useReturns(page: number) {
  return useQuery({
    queryKey: ['returns', 'list', page],
    queryFn: () => api<Paginated<ReturnSummary>>(`/returns?page=${page}&pageSize=20`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}
