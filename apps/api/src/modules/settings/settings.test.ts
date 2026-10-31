import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { addMember, loginAs, registerOwner } from '../../test/helpers';
import { resetDb } from '../../test/db';
import { canonicalTimeZone, isValidCurrency } from '../../utils/locale';

const app = createApp({ authRateLimitMax: 1000 });

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

describe('locale helpers', () => {
  it('validates currency codes', () => {
    expect(isValidCurrency('USD')).toBe(true);
    expect(isValidCurrency('BDT')).toBe(true);
    expect(isValidCurrency('usd')).toBe(false);
    expect(isValidCurrency('XYZ')).toBe(false);
  });

  it('canonicalises time zones', () => {
    expect(canonicalTimeZone('asia/dhaka')).toBe('Asia/Dhaka');
    expect(canonicalTimeZone('UTC')).toBe('UTC');
    expect(canonicalTimeZone('Not/AZone')).toBeNull();
  });
});

describe('settings reads', () => {
  it('creates defaults at registration and returns decimal strings', async () => {
    const owner = await registerOwner(app, 'a');
    expect(await prisma.storeSetting.count({ where: { storeId: owner.storeId } })).toBe(1);
    const res = await request(app).get('/api/v1/settings').set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.storeName).toBe('Store a');
    expect(res.body.currency).toBe('USD');
    expect(res.body.timeZone).toBe('UTC');
    expect(res.body.taxRatePercent).toBe('0.00');
    expect(res.body.onboardingCompletedAt).toBeNull();
  });

  it('requires authentication and allows members to read', async () => {
    expect((await request(app).get('/api/v1/settings')).status).toBe(401);
    const owner = await registerOwner(app, 'member');
    const cashier = await addMember(app, owner.cookie, 'CASHIER', 'member');
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Cookie', await loginAs(app, cashier.email));
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('USD');
  });

  it('lazily creates a missing settings row', async () => {
    const owner = await registerOwner(app, 'lazy');
    await prisma.storeSetting.delete({ where: { storeId: owner.storeId } });
    const res = await request(app).get('/api/v1/settings').set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(await prisma.storeSetting.count({ where: { storeId: owner.storeId } })).toBe(1);
  });

  it('accepts an explicit store header for the member store', async () => {
    const owner = await registerOwner(app, 'header');
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Cookie', owner.cookie)
      .set('X-Store-Id', owner.storeId);
    expect(res.status).toBe(200);
    expect(res.body.storeName).toBe('Store header');
  });
});

describe('settings updates', () => {
  it('updates and normalises settings', async () => {
    const owner = await registerOwner(app, 'update');
    const res = await request(app).patch('/api/v1/settings').set('Cookie', owner.cookie).send({
      storeName: 'Renamed Shop',
      currency: 'bdt',
      timeZone: 'asia/dhaka',
      taxName: 'VAT',
      taxRatePercent: 7.5,
      taxInclusive: true,
      defaultLowStockThreshold: 10,
      address: '   ',
    });
    expect(res.status).toBe(200);
    expect(res.body.storeName).toBe('Renamed Shop');
    expect(res.body.currency).toBe('BDT');
    expect(res.body.timeZone).toBe('Asia/Dhaka');
    expect(res.body.taxRatePercent).toBe('7.50');
    expect(res.body.address).toBeNull();
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', owner.cookie);
    expect(me.body.memberships[0].storeName).toBe('Renamed Shop');
  });

  it('allows only owners to update', async () => {
    const owner = await registerOwner(app, 'roles');
    for (const role of ['MANAGER', 'CASHIER'] as const) {
      const member = await addMember(app, owner.cookie, role, role.toLowerCase());
      const res = await request(app)
        .patch('/api/v1/settings')
        .set('Cookie', await loginAs(app, member.email))
        .send({ currency: 'EUR' });
      expect(res.status).toBe(403);
    }
    expect(
      (await prisma.storeSetting.findUniqueOrThrow({ where: { storeId: owner.storeId } })).currency,
    ).toBe('USD');
  });

  it('rejects invalid currencies, time zones, and tax rates', async () => {
    const owner = await registerOwner(app, 'invalid');
    for (const currency of ['XYZ', 'US']) {
      const res = await request(app)
        .patch('/api/v1/settings')
        .set('Cookie', owner.cookie)
        .send({ currency });
      expect(res.status).toBe(400);
    }
    const timeZone = await request(app)
      .patch('/api/v1/settings')
      .set('Cookie', owner.cookie)
      .send({ timeZone: 'Not/AZone' });
    expect(timeZone.status).toBe(400);
    for (const taxRatePercent of [101, -1, 7.555]) {
      const res = await request(app)
        .patch('/api/v1/settings')
        .set('Cookie', owner.cookie)
        .send({ taxRatePercent });
      expect(res.status).toBe(400);
    }
  });

  it('rejects empty and unknown bodies', async () => {
    const owner = await registerOwner(app, 'body');
    expect(
      (await request(app).patch('/api/v1/settings').set('Cookie', owner.cookie).send({})).status,
    ).toBe(400);
    const foreign = await registerOwner(app, 'foreign');
    const res = await request(app)
      .patch('/api/v1/settings')
      .set('Cookie', owner.cookie)
      .send({ storeId: foreign.storeId, currency: 'EUR' });
    expect(res.status).toBe(400);
    expect(
      (await prisma.storeSetting.findUniqueOrThrow({ where: { storeId: owner.storeId } })).currency,
    ).toBe('USD');
  });

  it('validates contact email and stores nullable text', async () => {
    const owner = await registerOwner(app, 'contact');
    const invalid = await request(app)
      .patch('/api/v1/settings')
      .set('Cookie', owner.cookie)
      .send({ contactEmail: 'not-an-email' });
    const valid = await request(app)
      .patch('/api/v1/settings')
      .set('Cookie', owner.cookie)
      .send({ contactEmail: 'contact@example.com' });
    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    expect(valid.body.contactEmail).toBe('contact@example.com');
  });
});

describe('settings isolation and onboarding', () => {
  it('does not read or change another store settings', async () => {
    const a = await registerOwner(app, 'a');
    const b = await registerOwner(app, 'b');
    await request(app).patch('/api/v1/settings').set('Cookie', b.cookie).send({ currency: 'EUR' });
    expect((await request(app).get('/api/v1/settings').set('Cookie', a.cookie)).body.currency).toBe(
      'USD',
    );
    expect(
      (
        await request(app)
          .patch('/api/v1/settings')
          .set('Cookie', a.cookie)
          .set('X-Store-Id', b.storeId)
          .send({ currency: 'GBP' })
      ).status,
    ).toBe(403);
    expect(
      (await prisma.storeSetting.findUniqueOrThrow({ where: { storeId: b.storeId } })).currency,
    ).toBe('EUR');
  });

  it('sets onboarding timestamp once', async () => {
    const owner = await registerOwner(app, 'onboard');
    const first = await request(app)
      .patch('/api/v1/settings')
      .set('Cookie', owner.cookie)
      .send({ currency: 'EUR', completeOnboarding: true });
    const second = await request(app)
      .patch('/api/v1/settings')
      .set('Cookie', owner.cookie)
      .send({ completeOnboarding: true });
    expect(first.status).toBe(200);
    expect(second.body.onboardingCompletedAt).toBe(first.body.onboardingCompletedAt);
  });

  it('does not let a cashier complete onboarding', async () => {
    const owner = await registerOwner(app, 'cashier-onboard');
    const cashier = await addMember(app, owner.cookie, 'CASHIER', 'cashier-onboard');
    const res = await request(app)
      .patch('/api/v1/settings')
      .set('Cookie', await loginAs(app, cashier.email))
      .send({ completeOnboarding: true });
    expect(res.status).toBe(403);
    expect(
      (await prisma.storeSetting.findUniqueOrThrow({ where: { storeId: owner.storeId } }))
        .onboardingCompletedAt,
    ).toBeNull();
  });

  it('denies an unknown store header without revealing store existence', async () => {
    const owner = await registerOwner(app, 'unknown');
    const res = await request(app)
      .get('/api/v1/settings')
      .set('Cookie', owner.cookie)
      .set('X-Store-Id', '00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STORE_ACCESS_DENIED');
  });

  it('returns the updated settings after a partial change', async () => {
    const owner = await registerOwner(app, 'partial');
    const res = await request(app)
      .patch('/api/v1/settings')
      .set('Cookie', owner.cookie)
      .send({ taxName: 'VAT' });
    expect(res.status).toBe(200);
    expect(res.body.taxName).toBe('VAT');
    expect(res.body.currency).toBe('USD');
  });
});
