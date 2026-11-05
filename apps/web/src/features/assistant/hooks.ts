import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { AiAnswer, AiStatus } from '../../types/api';

export function useAiStatus() {
  return useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => api<AiStatus>('/ai/status'),
    retry: false,
  });
}

export function useAsk() {
  return useMutation({
    mutationFn: (question: string) =>
      api<AiAnswer>('/ai/ask', { method: 'POST', body: { question } }),
  });
}
