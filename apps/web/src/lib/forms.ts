import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (error.code === 'VALIDATION_ERROR' && error.details?.length) {
    for (const issue of error.details) {
      setError(issue.field as Path<T>, { message: issue.message });
    }
    return null;
  }
  if (error.status >= 500 && error.requestId) {
    return `${error.message} (Request ID: ${error.requestId})`;
  }
  return error.message;
}
