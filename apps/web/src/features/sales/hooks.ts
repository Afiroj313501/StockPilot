import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type {
  CartDiscount,
  CheckoutPayload,
  Paginated,
  SaleDetail,
  SalePreview,
  SaleSummary,
} from '../../types/api';

// The server prices the cart; the browser never calculates totals itself.
export function useSalePreview(
  items: { productId: string; quantity: number }[],
  discount: CartDiscount | null,
) {
  return useQuery({
    queryKey: ['sales', 'preview', items, discount],
    queryFn: () =>
      api<SalePreview>('/sales/preview', { method: 'POST', body: { items, discount } }),
    enabled: items.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CheckoutPayload) => api<SaleDetail>('/sales', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['products'] }); // stock changed
      void qc.invalidateQueries({ queryKey: ['inventory'] }); // new ledger rows
    },
  });
}

export function useSales(page: number) {
  return useQuery({
    queryKey: ['sales', 'list', page],
    queryFn: () => api<Paginated<SaleSummary>>(`/sales?page=${page}&pageSize=20`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useSale(id: string | undefined) {
  return useQuery({
    queryKey: ['sales', 'detail', id],
    queryFn: () => api<SaleDetail>(`/sales/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
}
