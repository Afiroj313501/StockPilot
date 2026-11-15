const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generatePassword(length = 16): string {
  const limit = Math.floor(0x100000000 / ALPHABET.length) * ALPHABET.length;
  const buffer = new Uint32Array(1);
  let out = '';
  while (out.length < length) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] as number;
    if (value < limit) out += ALPHABET[value % ALPHABET.length];
  }
  return out;
}
