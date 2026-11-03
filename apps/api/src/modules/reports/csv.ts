// A numeric or otherwise trusted cell, written as-is.
export class Raw {
  constructor(public readonly value: string) {}
}
export type Cell = string | Raw;

// Spreadsheets treat cells starting with these characters as formulas. Text cells (names,
// notes...) get a leading apostrophe so imported data can never run as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

function cellText(cell: Cell): string {
  let text: string;
  if (cell instanceof Raw) {
    text = cell.value;
  } else {
    text = FORMULA_START.test(cell) ? `'${cell}` : cell;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// UTF-8 with a byte-order mark (so Excel reads it correctly) and CRLF line endings.
export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(cellText).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
