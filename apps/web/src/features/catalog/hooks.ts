import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Category, Paginated, Product, ProductPayload } from '../../types/api';

export interface ProductFilters {
  search: string;
  categoryId: string;
  status: 'active' | 'archived' | 'all';
  sort: 'name' | 'sku' | 'sellingPrice' | 'stockQuantity' | 'createdAt';
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}
function queryString(filters: ProductFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => params.set(key, String(value)));
  return params.toString();
}
export function useProducts(filters: ProductFilters) {
  return useQuery({
    queryKey: ['products', 'list', filters],
    queryFn: () => api<Paginated<Product>>(`/products?${queryString(filters)}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
}
export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ['products', 'detail', id],
    queryFn: () => api<Product>(`/products/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
}
export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProductPayload) => api<Product>('/products', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['products'] }),
  });
}
export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<ProductPayload> & { isActive?: boolean };
    }) => api<Product>(`/products/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['products'] }),
  });
}
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api<{ items: Category[] }>('/categories')).items,
    retry: false,
  });
}
export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id?: string; name: string }) =>
      id
        ? api<Category>(`/categories/${id}`, { method: 'PATCH', body: { name } })
        : api<Category>('/categories', { method: 'POST', body: { name } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}
