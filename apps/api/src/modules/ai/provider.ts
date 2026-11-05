// The interface every AI provider adapter implements. The rest of the app only knows this.

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON text, exactly as the model produced it
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ProviderRequest {
  messages: ChatMessage[];
  tools: ToolSpec[];
  timeoutMs: number;
}

export interface ProviderResponse {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface AiProvider {
  readonly name: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export type ProviderErrorCode = 'TIMEOUT' | 'RATE_LIMITED' | 'AUTH' | 'UNAVAILABLE' | 'BAD_RESPONSE';

// Messages are written by us and never contain the provider's response body or any credentials.
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
  }
}