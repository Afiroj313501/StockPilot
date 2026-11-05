import { describe, expect, it } from 'vitest';
import { resolveProvider, type AiSettings } from './config';

const base: AiSettings = {
  AI_PROVIDER: 'openai-compatible',
  AI_API_KEY: 'k',
  AI_MODEL: 'm',
  AI_BASE_URL: 'https://llm.example.test/v1',
  AI_TIMEOUT_MS: 15000,
};

describe('resolveProvider', () => {
  it('uses built-in mode unless the provider is fully configured', () => {
    expect(resolveProvider({ ...base, AI_PROVIDER: 'none' })).toMatchObject({
      provider: null,
      reason: 'DISABLED',
    });
    expect(resolveProvider({ ...base, AI_API_KEY: undefined })).toMatchObject({
      provider: null,
      reason: 'NOT_CONFIGURED',
    });
    expect(resolveProvider({ ...base, AI_API_KEY: '   ' })).toMatchObject({
      provider: null,
      reason: 'NOT_CONFIGURED',
    });
    expect(resolveProvider({ ...base, AI_MODEL: '' })).toMatchObject({
      provider: null,
      reason: 'NOT_CONFIGURED',
    });

    const enabled = resolveProvider(base);
    expect(enabled.reason).toBe('ENABLED');
    expect(enabled.provider?.name).toBe('openai-compatible');
    expect(enabled.timeoutMs).toBe(15000);
  });
});
