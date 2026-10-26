import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

describe('GET /api/v1/health', () => {
  const app = createApp();

  it('returns ok with a request id header', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns a safe JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
