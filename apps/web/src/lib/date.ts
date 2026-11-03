// Calendar arithmetic on YYYY-MM-DD strings (no time zones involved).
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const firstOfMonth = (date: string): string => `${date.slice(0, 8)}01`;
