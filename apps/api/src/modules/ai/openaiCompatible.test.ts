import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleProvider } from './openaiCompatible';
import type { ProviderRequest } from './provider';

const KEY = 'sk-test-secret';
const provider = createOpenAiCompatibleProvider({ baseUrl: 'https://llm.example.test/v1/', apiKey: KEY, model: 'm1' });

const request: ProviderRequest = {
  messages: [
    { role: 'system', content: 's' },
    { role: 'user', content: 'q' },
    { role: 'assistant', content: null, toolCalls: [{ id: 'x', name: 't', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'x', content: '{}' },
  ],
  tools: [{ name: 'getLowStockProducts', description: 'd', parameters: { type: 'object' } }],
  timeoutMs: 1000,
};

const reply = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI-compatible adapter', () => {
  it('sends the chat request and parses text and tool calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'getLowStockProducts', arguments: '{"limit":3}' } }],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(reply({ choices: [{ message: { content: 'hello' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await provider.complete(request)).toEqual({
      content: null,
      toolCalls: [{ id: 'c1', name: 'getLowStockProducts', arguments: '{"limit":3}' }],
    });
    expect(await provider.complete(request)).toEqual({ content: 'hello', toolCalls: [] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'm1', temperature: 0, tool_choice: 'auto' });
    expect(body.tools[0].function.name).toBe('getLowStockProducts');
    expect(body.messages[2].tool_calls[0]).toEqual({ id: 'x', type: 'function', function: { name: 't', arguments: '{}' } });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'x', content: '{}' });
  });

  it('maps HTTP and network failures to provider error codes without leaking details', async () => {
    const cases: [number, string][] = [
      [401, 'AUTH'],
      [403, 'AUTH'],
      [429, 'RATE_LIMITED'],
      [500, 'UNAVAILABLE'],
      [503, 'UNAVAILABLE'],
      [400, 'BAD_RESPONSE'],
      [404, 'BAD_RESPONSE'],
    ];
    for (const [status, code] of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(`provider says ${KEY}`, status)));
      const error = await provider.complete(request).catch((e: Error) => e);
      expect(error).toMatchObject({ code });
      expect((error as Error).message).not.toContain(KEY);
      expect((error as Error).message).not.toContain('provider says');
    }

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(provider.complete(request)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('times out and rejects malformed responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      ),
    );
    await expect(provider.complete({ ...request, timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });

    for (const body of ['not json', { choices: [] }, { choices: [{ message: { content: 5 } }] }, {}]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
      await expect(provider.complete(request)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    }
  });
});