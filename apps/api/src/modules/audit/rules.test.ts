import { describe, expect, it } from 'vitest';
import { describeRequest, type RequestInfo } from './rules';

const ID = '11111111-2222-4333-8444-555555555555';
const info = (method: string, path: string, extra: Partial<RequestInfo> = {}): RequestInfo => ({
  method,
  path,
  query: {},
  body: {},
  response: null,
  ...extra,
});

describe('describeRequest: catalogue', () => {
  it('describes product, category and supplier changes by field name', () => {
    expect(
      describeRequest(
        info('POST', '/api/v1/products', { response: { id: 'p1', name: 'Cola', sku: 'COLA-1' } }),
      ),
    ).toEqual({
      action: 'product.create',
      resourceType: 'Product',
      resourceId: 'p1',
      summary: 'Created product "Cola" (COLA-1)',
    });
    expect(
      describeRequest(
        info('PATCH', `/api/v1/products/${ID}`, {
          body: { sellingPrice: 3, name: 'x' },
          response: { name: 'Cola' },
        }),
      ),
    ).toEqual({
      action: 'product.update',
      resourceType: 'Product',
      resourceId: ID,
      summary: 'Updated product "Cola": name, sellingPrice',
      metadata: { fields: ['name', 'sellingPrice'] },
    });
    expect(
      describeRequest(
        info('PATCH', `/api/v1/products/${ID}`, {
          body: { isActive: false },
          response: { name: 'Cola', isActive: false },
        }),
      )?.action,
    ).toBe('product.archive');
    expect(
      describeRequest(
        info('PATCH', `/api/v1/products/${ID}`, {
          body: { isActive: true },
          response: { name: 'Cola', isActive: true },
        }),
      )?.action,
    ).toBe('product.restore');
    expect(describeRequest(info('DELETE', `/api/v1/products/${ID}`))).toMatchObject({
      action: 'product.delete',
      resourceId: ID,
    });
    expect(
      describeRequest(
        info('POST', '/api/v1/categories', { response: { id: 'c1', name: 'Drinks' } }),
      )?.summary,
    ).toBe('Created category "Drinks"');
    expect(
      describeRequest(
        info('PATCH', `/api/v1/suppliers/${ID}`, {
          body: { isActive: false },
          response: { name: 'Acme', isActive: false },
        }),
      ),
    ).toMatchObject({
      action: 'supplier.archive',
      summary: 'Archived supplier "Acme"',
    });
  });
});

describe('describeRequest: stock, purchasing and sales', () => {
  it('describes movements, purchase orders, sales, returns and planner decisions', () => {
    expect(
      describeRequest(
        info('POST', '/api/v1/inventory/movements', {
          response: {
            productId: 'p1',
            productName: 'Cola',
            type: 'DAMAGED',
            quantityChange: -2,
            quantityBefore: 10,
            quantityAfter: 8,
          },
        }),
      ),
    ).toEqual({
      action: 'inventory.movement',
      resourceType: 'Product',
      resourceId: 'p1',
      summary: 'Damaged: -2 unit(s) of "Cola" (10 -> 8)',
      metadata: { type: 'DAMAGED', quantityChange: -2, quantityBefore: 10, quantityAfter: 8 },
    });

    const po = {
      id: 'po1',
      reference: 'PO-0001',
      supplierName: 'Acme',
      total: '9.75',
      status: 'PARTIALLY_RECEIVED',
    };
    expect(describeRequest(info('POST', '/api/v1/purchases', { response: po }))?.summary).toBe(
      'Created PO-0001 for "Acme" (total 9.75)',
    );
    expect(
      describeRequest(info('POST', `/api/v1/purchases/${ID}/submit`, { response: po })),
    ).toMatchObject({
      action: 'purchase.submit',
      resourceId: ID,
      summary: 'Submitted PO-0001 for approval',
    });
    expect(
      describeRequest(info('POST', `/api/v1/purchases/${ID}/approve`, { response: po }))?.summary,
    ).toBe('Approved PO-0001');
    expect(
      describeRequest(info('POST', `/api/v1/purchases/${ID}/cancel`, { response: po }))?.summary,
    ).toBe('Cancelled PO-0001');
    expect(
      describeRequest(
        info('POST', `/api/v1/purchases/${ID}/receive`, {
          body: { items: [{}, {}] },
          response: po,
        }),
      )?.summary,
    ).toBe('Received stock on PO-0001 (2 line(s)); the order is now partially received');

    expect(
      describeRequest(
        info('POST', '/api/v1/sales', {
          response: {
            id: 's1',
            reference: 'S-000001',
            total: '8.80',
            currency: 'USD',
            payments: [{ method: 'CASH' }],
          },
        }),
      ),
    ).toEqual({
      action: 'sale.create',
      resourceType: 'Sale',
      resourceId: 's1',
      summary: 'Sale S-000001 completed: total 8.80 USD (CASH)',
      metadata: { total: '8.80', method: 'CASH' },
    });
    expect(
      describeRequest(
        info('POST', '/api/v1/returns', {
          response: {
            id: 'r1',
            reference: 'R-000001',
            saleReference: 'S-000001',
            refundTotal: '8.80',
            refundMethod: 'CASH',
          },
        }),
      )?.summary,
    ).toBe('Return R-000001 for S-000001: refund 8.80 (CASH)');

    expect(
      describeRequest(
        info('POST', `/api/v1/forecasting/products/${ID}/approve`, {
          response: { id: 'po3', reference: 'PO-0003', items: [{ quantityOrdered: 14 }] },
        }),
      ),
    ).toEqual({
      action: 'reorder.draft_created',
      resourceType: 'PurchaseOrder',
      resourceId: 'po3',
      summary: 'Created draft PO-0003 from the reorder planner',
      metadata: { productId: ID, quantity: 14 },
    });
    expect(
      describeRequest(info('POST', `/api/v1/forecasting/products/${ID}/dismiss`)),
    ).toMatchObject({
      action: 'reorder.dismiss',
      resourceId: ID,
    });
  });
});

describe('describeRequest: users, settings, exports and what is not audited', () => {
  it('never puts passwords, emails or free-text setting values into an entry', () => {
    const created = describeRequest(
      info('POST', '/api/v1/users', {
        body: { name: 'A', email: 'a@x.test', password: 'SecretPassword1', role: 'CASHIER' },
        response: { userId: 'u1', name: 'Cash One', role: 'CASHIER', email: 'a@x.test' },
      }),
    );
    expect(created).toEqual({
      action: 'user.create',
      resourceType: 'User',
      resourceId: 'u1',
      summary: 'Created a CASHIER account for "Cash One"',
    });
    expect(JSON.stringify(created)).not.toContain('SecretPassword1');
    expect(JSON.stringify(created)).not.toContain('@');

    expect(
      describeRequest(
        info('PATCH', `/api/v1/users/${ID}/role`, { response: { userId: ID, role: 'MANAGER' } }),
      )?.summary,
    ).toBe('Changed the role of user 11111111 to MANAGER');

    expect(
      describeRequest(
        info('PATCH', '/api/v1/settings', {
          body: {
            currency: 'EUR',
            taxRatePercent: 7.5,
            receiptFooter: 'Private note',
            address: '1 Secret St',
          },
        }),
      ),
    ).toEqual({
      action: 'settings.update',
      resourceType: 'Settings',
      resourceId: null,
      summary: 'Changed store settings: address, currency, receiptFooter, taxRatePercent',
      metadata: {
        fields: ['address', 'currency', 'receiptFooter', 'taxRatePercent'],
        values: { currency: 'EUR', taxRatePercent: 7.5 },
      },
    });

    expect(
      describeRequest(
        info('GET', '/api/v1/reports/export/sales', {
          query: { from: '2026-11-01', to: '2026-11-03' },
        }),
      )?.summary,
    ).toBe('Downloaded the sales CSV (2026-11-01 to 2026-11-03)');
    expect(describeRequest(info('GET', '/api/v1/reports/export/products'))?.summary).toBe(
      'Downloaded the products CSV (the last 30 days)',
    );

    for (const [method, path] of [
      ['GET', '/api/v1/products'],
      ['GET', '/api/v1/audit-logs'],
      ['POST', '/api/v1/ai/ask'],
      ['POST', '/api/v1/auth/login'],
      ['POST', '/api/v1/sales/preview'],
      ['POST', '/api/v1/returns/preview'],
      ['PATCH', '/api/v1/audit-logs'],
    ] as const) {
      expect(describeRequest(info(method, path))).toBeNull();
    }
  });
});
