import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type {
  CategoryReportRow,
  Dashboard,
  InventoryReport,
  ProductReportRow,
  ReportPeriod,
  SalesSummary,
} from '../../types/api';

// null means "let the server choose": the last 30 days in the store's time zone.
export interface DateRange {
  from: string;
  to: string;
}

function qs(range: DateRange | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (range) {
    params.set('from', range.from);
    params.set('to', range.to);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function useDashboard(range: DateRange | null) {
  return useQuery({
    queryKey: ['reports', 'dashboard', range],
    queryFn: () => api<Dashboard>(`/reports/dashboard${qs(range)}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useSalesSummary(range: DateRange | null, group: 'day' | 'week' | 'month') {
  return useQuery({
    queryKey: ['reports', 'summary', range, group],
    queryFn: () => api<SalesSummary>(`/reports/summary${qs(range, { group })}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useProductReport(range: DateRange | null, sort: 'revenue' | 'units' | 'profit') {
  return useQuery({
    queryKey: ['reports', 'products', range, sort],
    queryFn: () =>
      api<{ period: ReportPeriod; items: ProductReportRow[] }>(`/reports/products${qs(range, { sort, limit: '100' })}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useCategoryReport(range: DateRange | null) {
  return useQuery({
    queryKey: ['reports', 'categories', range],
    queryFn: () => api<{ period: ReportPeriod; items: CategoryReportRow[] }>(`/reports/categories${qs(range)}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useInventoryReport() {
  return useQuery({
    queryKey: ['reports', 'inventory'],
    queryFn: () => api<InventoryReport>('/reports/inventory'),
    retry: false,
  });
}

// A plain link: the browser downloads the file with the session cookie.
export function exportHref(kind: string, range: DateRange | null, group?: string): string {
  return `/api/v1/reports/export/${kind}${qs(range, group ? { group } : {})}`;
}