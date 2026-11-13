import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { ImportReport, ImportResult } from '../../types/api';

interface ImportBody {
  csv: string;
  existing: 'skip' | 'update';
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: (body: ImportBody) =>
      api<ImportReport>('/products/import/preview', { method: 'POST', body }),
  });
}

export function useImportProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportBody) =>
      api<ImportResult>('/products/import', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}
