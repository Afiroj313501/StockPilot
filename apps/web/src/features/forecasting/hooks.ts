import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type {
  CreateDraftPayload,
  PurchaseDetail,
  ReorderParams,
  ReorderResponse,
} from '../../types/api';

export function useReorder(params: ReorderParams, includeHandled: boolean) {
  const qs = new URLSearchParams({
    windowDays: String(params.windowDays),
    safetyDays: String(params.safetyDays),
    coverageDays: String(params.coverageDays),
    includeHandled: String(includeHandled),
  });
  return useQuery({
    queryKey: ['reorder', params, includeHandled],
    queryFn: () => api<ReorderResponse>(`/forecasting/recommendations?${qs.toString()}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useCreateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, body }: { productId: string; body: CreateDraftPayload }) =>
      api<PurchaseDetail>(`/forecasting/products/${productId}/approve`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reorder'] });
      void qc.invalidateQueries({ queryKey: ['purchases'] });
    },
  });
}

export function useDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      productId,
      kind,
      params,
    }: {
      productId: string;
      kind: 'dismiss' | 'review';
      params: ReorderParams;
    }) =>
      api<{ id: string }>(`/forecasting/products/${productId}/${kind}`, {
        method: 'POST',
        body: { params },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['reorder'] }),
  });
}
