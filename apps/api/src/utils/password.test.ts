import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword } from './password';

describe('generateTemporaryPassword', () => {
  it('uses the unambiguous alphabet and requested length', () => {
    expect(generateTemporaryPassword()).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]{16}$/,
    );
    expect(generateTemporaryPassword(24)).toHaveLength(24);
  });
});
