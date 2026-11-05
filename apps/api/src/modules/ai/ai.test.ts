import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import { addMember, createProduct, loginAs, registerOwner } from '../../test/helpers';
import type { AiProvider, ProviderResponse } from './provider';

const app = createApp({ authRateLimitMax: 1000, aiProvider: null });

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
const nextKey = () => `ai-test-${Date.now()}-${++counter}`;

async function addStock(cookie: string, productId: string, quantity: number) {
  const response = await request(app)
    .post('/api/v1/inventory/movements')
    .set('Cookie', cookie)
    .send({ productId, type: 'OPENING', quantity, idempotencyKey: nextKey() });
  expect(response.status).toBe(201);
}

async function fixture() {
  const owner = await registerOwner(app, 'ai');
  const manager = await addMember(app, owner.cookie, 'MANAGER', 'ai');
  const cashier = await addMember(app, owner.cookie, 'CASHIER', 'ai');
  const managerCookie = await loginAs(app, manager.email);
  const cashierCookie = await loginAs(app, cashier.email);
  const product = await createProduct(app, owner.cookie, {
    name: 'Cola',
    sellingPrice: 10,
    costPrice: 4,
  });
  await addStock(owner.cookie, product, 10);
  return { owner, managerCookie, cashierCookie, product };
}

const ask = (target: Express, cookie: string, question: string) =>
  request(target).post('/api/v1/ai/ask').set('Cookie', cookie).send({ question });

const text = (content: string): ProviderResponse => ({ content, toolCalls: [] });
const useTool = (name: string): ProviderResponse => ({
  content: null,
  toolCalls: [{ id: 'call-1', name, arguments: '{}' }],
});

describe('AI routes', () => {
  it('reports built-in mode and answers supported questions', async () => {
    const setup = await fixture();
    const status = await request(app).get('/api/v1/ai/status').set('Cookie', setup.managerCookie);

    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      mode: 'BUILT_IN',
      reason: 'DISABLED',
      providerName: null,
    });
    expect(status.body.privacy).toContain('never sent');

    const result = await ask(app, setup.managerCookie, 'What is my inventory worth?');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'ANSWERED', mode: 'BUILT_IN' });
    expect(result.body.answer).toContain('10 unit(s)');
    expect(result.body.evidence[0]).toMatchObject({ tool: 'getInventoryValuation' });
  });

  it('rejects invalid questions and cashier access', async () => {
    const setup = await fixture();

    expect((await ask(app, setup.cashierCookie, 'What is my inventory worth?')).status).toBe(403);
    for (const body of [
      {},
      { question: '' },
      { question: 'x'.repeat(501) },
      { question: 'ok', storeId: 'x' },
    ]) {
      const response = await request(app)
        .post('/api/v1/ai/ask')
        .set('Cookie', setup.managerCookie)
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('uses provider tool results and builds evidence server-side', async () => {
    const setup = await fixture();
    const calls: string[] = [];
    const provider: AiProvider = {
      name: 'fake',
      async complete(request) {
        calls.push(JSON.stringify(request.messages));
        return calls.length === 1
          ? useTool('getInventoryValuation')
          : text(JSON.stringify({ status: 'ANSWERED', answer: 'Inventory is worth 40.00.' }));
      },
    };
    const providerApp = createApp({ authRateLimitMax: 1000, aiProvider: provider });
    const result = await ask(providerApp, setup.managerCookie, 'What is my inventory worth?');

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: 'ANSWERED',
      mode: 'AI',
      answer: 'Inventory is worth 40.00.',
    });
    expect(result.body.evidence).toHaveLength(1);
    expect(result.body.evidence[0].tool).toBe('getInventoryValuation');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('costValue');
  });

  it('falls back to built-in answers when the provider gives an ungrounded answer', async () => {
    const setup = await fixture();
    const provider: AiProvider = {
      name: 'fake',
      async complete() {
        return text(JSON.stringify({ status: 'ANSWERED', answer: 'Inventory is worth 999.99.' }));
      },
    };
    const providerApp = createApp({ authRateLimitMax: 1000, aiProvider: provider });
    const result = await ask(providerApp, setup.managerCookie, 'What is my inventory worth?');

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'ANSWERED', mode: 'BUILT_IN' });
    expect(result.body.notice).toContain('could not be verified');
    expect(result.body.answer).not.toContain('999.99');
  });

  it('rate limits questions per user', async () => {
    const setup = await fixture();
    const limited = createApp({ authRateLimitMax: 1000, aiRateLimitMax: 1, aiProvider: null });

    expect((await ask(limited, setup.managerCookie, 'What is my inventory worth?')).status).toBe(
      200,
    );
    const blocked = await ask(limited, setup.managerCookie, 'What is my inventory worth?');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect((await ask(limited, setup.owner.cookie, 'What is my inventory worth?')).status).toBe(
      200,
    );
  });
});
