import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { AuditActionInfo, AuditLogItem, Member, Paginated } from '../../types/api';

export interface AuditFilters {
  action: string;
  actorUserId: string;
  from: string;
  to: string;
  page: number;
}

export function useAuditLogs(f: AuditFilters) {
  const params = new URLSearchParams({ page: String(f.page), pageSize: '25' });
  if (f.action) params.set('action', f.action);
  if (f.actorUserId) params.set('actorUserId', f.actorUserId);
  if (f.from && f.to) {
    params.set('from', f.from);
    params.set('to', f.to);
  }
  return useQuery({
    queryKey: ['audit', 'list', f],
    queryFn: () => api<Paginated<AuditLogItem>>(`/audit-logs?${params.toString()}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: ['audit', 'actions'],
    queryFn: async () => (await api<{ items: AuditActionInfo[] }>('/audit-logs/actions')).items,
    staleTime: Infinity,
    retry: false,
  });
}

export function useMembers() {
  return useQuery({
    queryKey: ['members'],
    queryFn: async () => (await api<{ items: Member[] }>('/users')).items,
    retry: false,
  });
}
