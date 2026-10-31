export function canonicalTimeZone(value: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

const CURRENCY_CODES = new Set<string>(Intl.supportedValuesOf('currency'));

export function isValidCurrency(code: string): boolean {
  return CURRENCY_CODES.has(code);
}
