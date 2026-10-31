import { Button } from './Button';

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (!total) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between pt-4">
      <p className="text-sm text-slate-600">
        Page {page} of {Math.max(totalPages, 1)} · {total} {total === 1 ? 'item' : 'items'}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}
