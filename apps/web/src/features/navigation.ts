import { LayoutDashboard, Settings, type LucideIcon } from 'lucide-react';
import type { Role } from '../types/api';

const RANK: Record<Role, number> = { CASHIER: 1, MANAGER: 2, OWNER: 3 };

export function hasRole(actual: Role, minimum: Role): boolean {
  return RANK[actual] >= RANK[minimum];
}

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  minRole: Role;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, minRole: 'CASHIER' },
  { to: '/settings', label: 'Settings', icon: Settings, minRole: 'OWNER' },
];
