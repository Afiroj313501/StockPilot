import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { useCategories, useDeleteCategory, useSaveCategory } from '../features/catalog/hooks';
export function CategoriesPage() {
  const categories = useCategories();
  const save = useSaveCategory();
  const remove = useDeleteCategory();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | undefined>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    save.mutate(
      { id: editing, name: name.trim() },
      {
        onSuccess: () => {
          setName('');
          setEditing(undefined);
        },
      },
    );
  };
  return (
    <div>
      <h1 className="text-2xl font-semibold">Categories</h1>
      <form onSubmit={submit} className="mt-6 flex max-w-xl items-end gap-3">
        <TextField
          label={editing ? 'Rename category' : 'New category'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button loading={save.isPending}>{editing ? 'Save' : 'Add'}</Button>
        {editing && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditing(undefined);
              setName('');
            }}
          >
            Cancel
          </Button>
        )}
      </form>
      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <ul className="divide-y">
          {categories.data?.map((category) => (
            <li key={category.id} className="flex items-center justify-between px-4 py-3">
              <span>
                {category.name}{' '}
                <span className="text-sm text-slate-500">({category.productCount})</span>
              </span>
              <span className="flex gap-3">
                <button
                  className="text-blue-600"
                  onClick={() => {
                    setEditing(category.id);
                    setName(category.name);
                  }}
                >
                  Rename
                </button>
                <button
                  className="text-red-600"
                  onClick={() => {
                    if (window.confirm(`Delete ${category.name}?`)) remove.mutate(category.id);
                  }}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
