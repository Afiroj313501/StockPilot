import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, error, hint, children, ...rest },
  ref,
) {
  const id = useId();
  const descriptionId = `${id}-desc`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-navy-900">
        {label}
      </label>
      <select
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? descriptionId : undefined}
        className={`mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-blue-600 ${error ? 'border-red-500' : 'border-slate-300'}`}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <p id={descriptionId} role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={descriptionId} className="mt-1 text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
