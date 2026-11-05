import { addDays, bucketStart } from '../reports/dateRange';

export interface Period {
  from: string;
  to: string;
  label: string;
  explicit: boolean; // false = the question named no period and the last 30 days were used
}

const firstOfMonth = (date: string) => `${date.slice(0, 8)}01`;

function firstOfPreviousMonth(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const py = month === 1 ? year - 1 : year;
  const pm = month === 1 ? 12 : month - 1;
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}

// Understands a handful of everyday phrases. `today` is the store-local date (YYYY-MM-DD).
export function resolvePeriod(question: string, today: string): Period {
  const q = question.toLowerCase();

  const lastDays = /(?:last|past)\s+(\d{1,3})\s+days?/.exec(q);
  if (lastDays) {
    const n = Math.min(Math.max(Number(lastDays[1]), 1), 365);
    return { from: addDays(today, -(n - 1)), to: today, label: `the last ${n} day(s)`, explicit: true };
  }
  if (q.includes('yesterday')) {
    const day = addDays(today, -1);
    return { from: day, to: day, label: 'yesterday', explicit: true };
  }
  if (q.includes('last week')) {
    const monday = bucketStart(today, 'week');
    return { from: addDays(monday, -7), to: addDays(monday, -1), label: 'last week', explicit: true };
  }
  if (q.includes('this week')) {
    return { from: bucketStart(today, 'week'), to: today, label: 'this week', explicit: true };
  }
  if (q.includes('last month')) {
    return {
      from: firstOfPreviousMonth(today),
      to: addDays(firstOfMonth(today), -1),
      label: 'last month',
      explicit: true,
    };
  }
  if (q.includes('this month')) {
    return { from: firstOfMonth(today), to: today, label: 'this month', explicit: true };
  }
  if (/\btoday\b/.test(q)) return { from: today, to: today, label: 'today', explicit: true };

  return { from: addDays(today, -29), to: today, label: 'the last 30 days', explicit: false };
}