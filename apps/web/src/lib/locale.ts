export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function timeZoneOptions(current: string): string[] {
  return [...new Set<string>(['UTC', ...Intl.supportedValuesOf('timeZone'), current])].sort();
}

export function currencyOptions(current: string): { code: string; label: string }[] {
  const names = new Intl.DisplayNames(['en'], { type: 'currency' });
  const codes = new Set<string>([...Intl.supportedValuesOf('currency'), current]);
  return [...codes].sort().map((code) => ({ code, label: `${code} — ${names.of(code) ?? code}` }));
}
