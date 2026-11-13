export const DEFAULT_LIMITS = { maxRows: 2000, maxColumns: 20 };

export class CsvError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(message);
  }
}

export interface ParsedCsv {
  delimiter: ',' | ';' | '\t';
  rows: string[][];
  lines: number[]; // the line of the file where each row starts (the header is line 1)
}

// Looks at the first line only (outside quotes): comma, semicolon (many regional Excel
// exports) or tab, whichever is used most. Comma wins ties.
function detectDelimiter(text: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === '\n' || ch === '\r') break;
      if (ch === ',' || ch === ';' || ch === '\t') counts[ch]++;
    }
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

// A small RFC 4180 parser: quoted values, "" for a quote, line breaks inside quotes,
// CRLF or LF, and an optional byte-order mark. Empty lines are skipped.
export function parseCsv(
  input: string,
  limits: { maxRows: number; maxColumns: number } = DEFAULT_LIMITS,
): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  const lines: number[] = [];

  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let line = 1;
  let rowLine = 1;

  const endField = () => {
    row.push(field);
    field = '';
    afterQuote = false;
  };

  const endRow = () => {
    endField();
    // Empty lines, and lines of only separators (spreadsheets pad them), are skipped.
    if (!row.every((cell) => cell.trim() === '')) {
      if (row.length > limits.maxColumns) {
        throw new CsvError(`The row has more than ${limits.maxColumns} columns`, rowLine);
      }
      rows.push(row);
      lines.push(rowLine);
      if (rows.length > limits.maxRows + 1) {
        throw new CsvError(
          `Too many rows: the file can have at most ${limits.maxRows} data rows`,
          rowLine,
        );
      }
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }

    if (afterQuote && ch !== delimiter && ch !== '\n' && ch !== '\r') {
      throw new CsvError('Unexpected text after a closing quote', line);
    }
    if (ch === '"') {
      if (field !== '')
        throw new CsvError('A quote must start a value: put the whole value in quotes', line);
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      endField();
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
      continue;
    }
    field += ch;
  }

  if (inQuotes) throw new CsvError('A value is missing its closing quote', rowLine);
  if (field !== '' || row.length > 0) endRow();
  return { delimiter, rows, lines };
}
