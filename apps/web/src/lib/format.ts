export function formatMoney(value: string, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

export function formatDateTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// For date-only values such as "2026-12-01" (no time zone shifting).
export function formatDate(dateOnly: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${dateOnly}T00:00:00Z`),
    );
  } catch {
    return dateOnly;
  }
}
