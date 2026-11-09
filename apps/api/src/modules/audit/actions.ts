export interface AuditActionInfo {
  action: string;
  label: string;
  category: string;
}

export const AUDIT_ACTIONS: AuditActionInfo[] = [
  { action: 'auth.register', label: 'Account created', category: 'auth' },
  { action: 'auth.login', label: 'Signed in', category: 'auth' },
  { action: 'auth.login_failed', label: 'Failed sign-in', category: 'auth' },
  { action: 'auth.logout', label: 'Signed out', category: 'auth' },
  { action: 'user.create', label: 'User created', category: 'user' },
  { action: 'user.role_change', label: 'Role changed', category: 'user' },
  { action: 'settings.update', label: 'Settings changed', category: 'settings' },
  { action: 'category.create', label: 'Category created', category: 'category' },
  { action: 'category.update', label: 'Category renamed', category: 'category' },
  { action: 'category.delete', label: 'Category deleted', category: 'category' },
  { action: 'product.create', label: 'Product created', category: 'product' },
  { action: 'product.update', label: 'Product changed', category: 'product' },
  { action: 'product.archive', label: 'Product archived', category: 'product' },
  { action: 'product.restore', label: 'Product restored', category: 'product' },
  { action: 'product.delete', label: 'Product deleted', category: 'product' },
  { action: 'supplier.create', label: 'Supplier created', category: 'supplier' },
  { action: 'supplier.update', label: 'Supplier changed', category: 'supplier' },
  { action: 'supplier.archive', label: 'Supplier archived', category: 'supplier' },
  { action: 'supplier.restore', label: 'Supplier restored', category: 'supplier' },
  { action: 'inventory.movement', label: 'Stock adjusted', category: 'inventory' },
  { action: 'purchase.create', label: 'Purchase order created', category: 'purchase' },
  { action: 'purchase.update', label: 'Purchase order edited', category: 'purchase' },
  { action: 'purchase.submit', label: 'Purchase order submitted', category: 'purchase' },
  { action: 'purchase.approve', label: 'Purchase order approved', category: 'purchase' },
  { action: 'purchase.cancel', label: 'Purchase order cancelled', category: 'purchase' },
  { action: 'purchase.receive', label: 'Stock received', category: 'purchase' },
  { action: 'reorder.draft_created', label: 'Draft order from planner', category: 'reorder' },
  { action: 'reorder.dismiss', label: 'Reorder suggestion dismissed', category: 'reorder' },
  { action: 'reorder.review', label: 'Reorder suggestion reviewed', category: 'reorder' },
  { action: 'sale.create', label: 'Sale completed', category: 'sale' },
  { action: 'return.create', label: 'Return recorded', category: 'return' },
  { action: 'export.download', label: 'CSV downloaded', category: 'export' },
];

export const ACTION_LABEL = new Map(AUDIT_ACTIONS.map((a) => [a.action, a.label]));
