import { useMe } from '../features/auth/hooks';

export function useAuthName(): string {
  return useMe().data?.user.name ?? '';
}
