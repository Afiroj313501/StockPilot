const SECRET_KEY = /pass(word)?|secret|token|api.?key|authorization|cookie|session|credential/i;
const MAX_STRING = 200;
const MAX_ITEMS = 20;
const MAX_DEPTH = 3;
const MAX_JSON = 2000;

function clean(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value === 'string')
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_STRING);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ITEMS)
      .map((v) => clean(v, depth + 1))
      .filter((v) => v !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      const cleaned = clean(v, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return undefined;
}

export function sanitizeMetadata(input: unknown): Record<string, unknown> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const cleaned = clean(input, 0) as Record<string, unknown>;
  return JSON.stringify(cleaned).length > MAX_JSON ? undefined : cleaned;
}
