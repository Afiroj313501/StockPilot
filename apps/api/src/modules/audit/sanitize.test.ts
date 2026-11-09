import { describe, expect, it } from 'vitest';
import { sanitizeMetadata } from './sanitize';

describe('sanitizeMetadata', () => {
  it('drops secret-looking keys, shortens strings and keeps the result small', () => {
    expect(
      sanitizeMetadata({
        password: 'hunter2',
        apiKey: 'sk-123',
        sessionId: 's',
        nested: { token: 't', ok: 1 },
        list: [1, 'a'.repeat(300)],
      }),
    ).toEqual({ nested: { ok: 1 }, list: [1, 'a'.repeat(200)] });

    expect(sanitizeMetadata({ big: Array.from({ length: 20 }, () => 'x'.repeat(200)) })).toBeUndefined();
    expect(sanitizeMetadata('just text')).toBeUndefined();
    expect(sanitizeMetadata(['a'])).toBeUndefined();
    expect(sanitizeMetadata({ value: Number.NaN, flag: true, none: null })).toEqual({ value: null, flag: true, none: null });
  });
});
