import {
  ProviderError,
  type AiProvider,
  type ProviderRequest,
  type ProviderResponse,
  type ToolCall,
} from './provider';

interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: unknown;
    };
  }>;
}

function mapMessages(request: ProviderRequest) {
  return request.messages.map((message) => {
    if (message.role === 'assistant') {
      return {
        role: message.role,
        content: message.content,
        ...(message.toolCalls
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function',
                function: { name: toolCall.name, arguments: toolCall.arguments },
              })),
            }
          : {}),
      };
    }
    if (message.role === 'tool') {
      return { role: message.role, tool_call_id: message.toolCallId, content: message.content };
    }
    return message;
  });
}

function parseResponse(body: unknown): ProviderResponse {
  if (!body || typeof body !== 'object')
    throw new ProviderError('BAD_RESPONSE', 'Invalid provider response.');
  const response = body as ChatResponse;
  const message = response.choices?.[0]?.message;
  if (!message || (message.content !== null && typeof message.content !== 'string')) {
    throw new ProviderError('BAD_RESPONSE', 'Invalid provider response.');
  }

  const rawToolCalls = message.tool_calls;
  if (rawToolCalls !== undefined && !Array.isArray(rawToolCalls)) {
    throw new ProviderError('BAD_RESPONSE', 'Invalid provider response.');
  }

  const toolCalls: ToolCall[] = (rawToolCalls ?? []).map((toolCall) => {
    if (!toolCall || typeof toolCall !== 'object')
      throw new ProviderError('BAD_RESPONSE', 'Invalid provider response.');
    const item = toolCall as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (
      typeof item.id !== 'string' ||
      typeof item.function?.name !== 'string' ||
      typeof item.function.arguments !== 'string'
    ) {
      throw new ProviderError('BAD_RESPONSE', 'Invalid provider response.');
    }
    return { id: item.id, name: item.function.name, arguments: item.function.arguments };
  });

  return { content: message.content as string | null, toolCalls };
}

function errorForStatus(status: number): ProviderError {
  if (status === 401 || status === 403)
    return new ProviderError('AUTH', 'AI provider authentication failed.');
  if (status === 429) return new ProviderError('RATE_LIMITED', 'AI provider rate limit reached.');
  if (status >= 500) return new ProviderError('UNAVAILABLE', 'AI provider is unavailable.');
  return new ProviderError('BAD_RESPONSE', 'AI provider returned an invalid response.');
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): AiProvider {
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    name: 'openai-compatible',
    async complete(request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: mapMessages(request),
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            temperature: 0,
            tool_choice: 'auto',
          }),
          signal: controller.signal,
        });

        if (!response.ok) throw errorForStatus(response.status);

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new ProviderError('BAD_RESPONSE', 'Invalid provider response.');
        }
        return parseResponse(body);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new ProviderError('TIMEOUT', 'AI provider request timed out.');
        }
        throw new ProviderError('UNAVAILABLE', 'AI provider is unavailable.');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
