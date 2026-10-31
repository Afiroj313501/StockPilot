export type Role = 'OWNER' | 'MANAGER' | 'CASHIER';

export interface Membership {
  storeId: string;
  storeName: string;
  role: Role;
}

export interface Account {
  user: { id: string; email: string; name: string };
  memberships: Membership[];
}
