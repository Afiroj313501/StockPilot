export type Group = 'day' | 'week' | 'month';

export const MAX_RANGE_DAYS = 731;
export const MAX_DAY_GROUP_DAYS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Pure calendar arithmetic on YYYY-MM-DD strings (no time zones involved).
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function parts(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(formatted.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

// The store-local calendar date right now, as YYYY-MM-DD.
export function localToday(timeZone: string, now: Date = new Date()): string {
  const p = parts(now, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// "2026-11-01 14:05" in the store's time zone.
export function formatLocalDateTime(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
}

function offsetMs(utcMs: number, timeZone: string): number {
  const p = parts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// The UTC instant at which the given local date starts in the time zone.
export function startOfLocalDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, 0, 0, 0);
  const first = guess - offsetMs(guess, timeZone);
  // Re-evaluate the offset at the candidate: it differs on a daylight-saving change day.
  const second = guess - offsetMs(first, timeZone);
  return new Date(second);
}

// [start, end): the UTC window covering local dates from..to inclusive.
export function rangeToUtc(from: string, to: string, timeZone: string): { start: Date; end: Date } {
  return { start: startOfLocalDay(from, timeZone), end: startOfLocalDay(addDays(to, 1), timeZone) };
}

// The first day of the bucket (day, ISO week starting Monday, or month) a date belongs to.
export function bucketStart(date: string, group: Group): string {
  if (group === 'day') return date;
  if (group === 'month') return `${date.slice(0, 8)}01`;
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dayOfWeek + 6) % 7));
}

export function bucketKeys(from: string, to: string, group: Group): string[] {
  const keys: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const key = bucketStart(d, group);
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return keys;
}