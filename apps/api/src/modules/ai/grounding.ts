const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

export function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? [])
    .map((t) => Number(t.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
}

// Numbers in an answer that cannot be traced to the data the lookups returned (or to the
// question itself). Whole numbers from 0 to 10 are allowed, because answers count list items.
// Digits inside identifiers are not treated as data.
export function ungroundedNumbers(answer: string, sources: string[], question: string): number[] {
  const allowed = new Set<number>();
  for (const source of sources)
    for (const n of numbersIn(source.replace(UUID, ' '))) allowed.add(n);
  for (const n of numbersIn(question)) allowed.add(n);

  return [...new Set(numbersIn(answer))].filter(
    (n) => !(Number.isInteger(n) && n >= 0 && n <= 10) && !allowed.has(n),
  );
}
