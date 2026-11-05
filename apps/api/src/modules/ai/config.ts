import { createOpenAiCompatibleProvider } from './openaiCompatible';
import type { AiProvider } from './provider';

export interface AiSettings {
  AI_PROVIDER: 'none' | 'openai-compatible';
  AI_API_KEY?: string | undefined;
  AI_MODEL?: string | undefined;
  AI_BASE_URL: string;
  AI_TIMEOUT_MS: number;
}

export interface ProviderStatus {
  provider: AiProvider | null;
  reason: 'ENABLED' | 'DISABLED' | 'NOT_CONFIGURED';
  timeoutMs: number;
}

// No key or no model simply means "built-in answers only". It is never an error.
export function resolveProvider(s: AiSettings): ProviderStatus {
  const timeoutMs = s.AI_TIMEOUT_MS;
  if (s.AI_PROVIDER === 'none') return { provider: null, reason: 'DISABLED', timeoutMs };

  const apiKey = s.AI_API_KEY?.trim();
  const model = s.AI_MODEL?.trim();
  if (!apiKey || !model) return { provider: null, reason: 'NOT_CONFIGURED', timeoutMs };

  return {
    provider: createOpenAiCompatibleProvider({ baseUrl: s.AI_BASE_URL, apiKey, model }),
    reason: 'ENABLED',
    timeoutMs,
  };
}