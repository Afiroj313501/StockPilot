export interface RequestInfo {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
  response: Record<string, unknown> | null;
}

export interface AuditDescription {
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}

const UUID = '[0-9a-fA-F-]{36}';
const route = (path: string) => new RegExp(`^/api/v1${path}$`);
const SENSITIVE = /pass(word)?|secret|token|api.?key|authorization|cookie|session|credential/i;

const clean = (v: unknown, max = 80): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const show = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const idOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v.slice(0, 64) : null);
const keysOf = (body: Record<string, unknown>): string[] =>
  Object.keys(body)
    .filter((k) => !SENSITIVE.test(k))
    .sort();
const signed = (n: unknown): string => (typeof n === 'number' ? (n > 0 ? `+${n}` : String(n)) : '?');

function d(
  action: string,
  resourceType: string | null,
  resourceId: unknown,
  summary: string,
  metadata?: Record<string, unknown>,
): AuditDescription {
  return { action, resourceType, resourceId: idOf(resourceId), summary, ...(metadata ? { metadata } : {}) };
}

const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: 'Opening stock',
  ADJUSTMENT: 'Adjustment',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  RECONCILIATION: 'Stock count',
};

const SAFE_SETTING_VALUES = new Set([
  'currency',
  'timeZone',
  'taxName',
  'taxRatePercent',
  'taxInclusive',
  'allowNegativeStock',
  'defaultLowStockThreshold',
  'defaultLeadTimeDays',
]);

type Res = Record<string, unknown>;
interface Rule {
  method: string;
  re: RegExp;
  build: (m: RegExpMatchArray, r: RequestInfo, res: Res) => AuditDescription;
}

function updateOrToggle(kind: 'product' | 'supplier', type: string, m: RegExpMatchArray, r: RequestInfo, res: Res) {
  const keys = keysOf(r.body);
  const name = clean(res.name);
  if (keys.length === 1 && keys[0] === 'isActive') {
    return res.isActive === false
      ? d(`${kind}.archive`, type, m[1], `Archived ${kind} "${name}"`)
      : d(`${kind}.restore`, type, m[1], `Restored ${kind} "${name}"`);
  }
  return d(`${kind}.update`, type, m[1], `Updated ${kind} "${name}": ${keys.join(', ')}`, { fields: keys });
}

const orderRef = (res: Res) => clean(res.reference, 20);

const RULES: Rule[] = [
  {
    method: 'POST',
    re: route('/products'),
    build: (_m, _r, res) => d('product.create', 'Product', res.id, `Created product "${clean(res.name)}" (${clean(res.sku, 40)})`),
  },
  { method: 'PATCH', re: route(`/products/(${UUID})`), build: (m, r, res) => updateOrToggle('product', 'Product', m, r, res) },
  { method: 'DELETE', re: route(`/products/(${UUID})`), build: (m) => d('product.delete', 'Product', m[1], 'Deleted a product') },
  {
    method: 'POST',
    re: route('/categories'),
    build: (_m, _r, res) => d('category.create', 'Category', res.id, `Created category "${clean(res.name)}"`),
  },
  {
    method: 'PATCH',
    re: route(`/categories/(${UUID})`),
    build: (m, _r, res) => d('category.update', 'Category', m[1], `Renamed a category to "${clean(res.name)}"`),
  },
  { method: 'DELETE', re: route(`/categories/(${UUID})`), build: (m) => d('category.delete', 'Category', m[1], 'Deleted a category') },
  {
    method: 'POST',
    re: route('/suppliers'),
    build: (_m, _r, res) => d('supplier.create', 'Supplier', res.id, `Created supplier "${clean(res.name)}"`),
  },
  { method: 'PATCH', re: route(`/suppliers/(${UUID})`), build: (m, r, res) => updateOrToggle('supplier', 'Supplier', m, r, res) },
  {
    method: 'POST',
    re: route('/inventory/movements'),
    build: (_m, _r, res) => {
      const label = MOVEMENT_LABEL[clean(res.type)] ?? 'Stock movement';
      return d(
        'inventory.movement',
        'Product',
        res.productId,
        `${label}: ${signed(res.quantityChange)} unit(s) of "${clean(res.productName)}" (${show(res.quantityBefore)} -> ${show(res.quantityAfter)})`,
        { type: res.type, quantityChange: res.quantityChange, quantityBefore: res.quantityBefore, quantityAfter: res.quantityAfter },
      );
    },
  },
  {
    method: 'POST',
    re: route('/purchases'),
    build: (_m, _r, res) =>
      d('purchase.create', 'PurchaseOrder', res.id, `Created ${orderRef(res)} for "${clean(res.supplierName)}" (total ${show(res.total)})`),
  },
  {
    method: 'PATCH',
    re: route(`/purchases/(${UUID})`),
    build: (m, r, res) => d('purchase.update', 'PurchaseOrder', m[1], `Edited ${orderRef(res)}`, { fields: keysOf(r.body) }),
  },
  {
    method: 'POST',
    re: route(`/purchases/(${UUID})/(submit|approve|cancel)`),
    build: (m, _r, res) => {
      const verb = { submit: 'Submitted', approve: 'Approved', cancel: 'Cancelled' }[m[2] as 'submit' | 'approve' | 'cancel'];
      return d(`purchase.${m[2]}`, 'PurchaseOrder', m[1], `${verb} ${orderRef(res)}${m[2] === 'submit' ? ' for approval' : ''}`);
    },
  },
  {
    method: 'POST',
    re: route(`/purchases/(${UUID})/receive`),
    build: (m, r, res) => {
      const lines = Array.isArray(r.body.items) ? r.body.items.length : 0;
      const status = clean(res.status).toLowerCase().replace(/_/g, ' ');
      return d('purchase.receive', 'PurchaseOrder', m[1], `Received stock on ${orderRef(res)} (${lines} line(s)); the order is now ${status}`);
    },
  },
  {
    method: 'POST',
    re: route('/sales'),
    build: (_m, _r, res) => {
      const payments = Array.isArray(res.payments) ? (res.payments as { method?: unknown }[]) : [];
      const method = clean(payments[0]?.method, 20);
      return d(
        'sale.create',
        'Sale',
        res.id,
        `Sale ${clean(res.reference, 20)} completed: total ${show(res.total)} ${clean(res.currency, 3)} (${method})`,
        { total: res.total, method },
      );
    },
  },
  {
    method: 'POST',
    re: route('/returns'),
    build: (_m, _r, res) =>
      d(
        'return.create',
        'Return',
        res.id,
        `Return ${clean(res.reference, 20)} for ${clean(res.saleReference, 20)}: refund ${show(res.refundTotal)} (${clean(res.refundMethod, 20)})`,
        { refundTotal: res.refundTotal },
      ),
  },
  {
    method: 'POST',
    re: route(`/forecasting/products/(${UUID})/approve`),
    build: (m, _r, res) => {
      const items = Array.isArray(res.items) ? (res.items as { quantityOrdered?: unknown }[]) : [];
      return d('reorder.draft_created', 'PurchaseOrder', res.id, `Created draft ${orderRef(res)} from the reorder planner`, {
        productId: m[1],
        quantity: items[0]?.quantityOrdered,
      });
    },
  },
  {
    method: 'POST',
    re: route(`/forecasting/products/(${UUID})/(dismiss|review)`),
    build: (m) =>
      m[2] === 'dismiss'
        ? d('reorder.dismiss', 'Product', m[1], 'Dismissed a reorder suggestion')
        : d('reorder.review', 'Product', m[1], 'Marked a reorder suggestion as reviewed'),
  },
  {
    method: 'PATCH',
    re: route('/settings'),
    build: (_m, r) => {
      const fields = keysOf(r.body);
      const values: Record<string, unknown> = {};
      for (const key of fields) if (SAFE_SETTING_VALUES.has(key)) values[key] = r.body[key];
      return d('settings.update', 'Settings', null, `Changed store settings: ${fields.join(', ')}`, { fields, values });
    },
  },
  {
    method: 'POST',
    re: route('/users'),
    build: (_m, _r, res) =>
      d('user.create', 'User', res.userId, `Created a ${clean(res.role, 20)} account for "${clean(res.name)}"`),
  },
  {
    method: 'PATCH',
    re: route(`/users/(${UUID})/role`),
    build: (m, _r, res) =>
      d('user.role_change', 'User', m[1], `Changed the role of user ${String(m[1]).slice(0, 8)} to ${clean(res.role, 20)}`, { role: res.role }),
  },
  {
    method: 'GET',
    re: route('/reports/export/([a-z-]+)'),
    build: (m, r) => {
      const from = typeof r.query.from === 'string' ? r.query.from : '';
      const to = typeof r.query.to === 'string' ? r.query.to : '';
      const period = from && to ? `${clean(from, 10)} to ${clean(to, 10)}` : 'the last 30 days';
      return d('export.download', null, null, `Downloaded the ${m[1]} CSV (${period})`, { kind: m[1], from: from || null, to: to || null });
    },
  },
];

export function describeRequest(r: RequestInfo): AuditDescription | null {
  const method = r.method.toUpperCase();
  const path = r.path.replace(/\/+$/, '');
  for (const rule of RULES) {
    if (rule.method !== method) continue;
    const match = path.match(rule.re);
    if (match) return rule.build(match, r, r.response ?? {});
  }
  return null;
}
