import { describe, expect, it } from 'vitest';
import { Raw, toCsv } from './csv';

const body = (csv: string) => csv.replace(/^\uFEFF/, '');

describe('toCsv', () => {
  it('writes a BOM, a header, rows and CRLF line endings', () => {
    const csv = toCsv(['A', 'B'], [['x', new Raw('1.50')]]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(body(csv)).toBe('A,B\r\nx,1.50\r\n');
  });

  it('quotes cells containing commas, quotes or line breaks', () => {
    const csv = body(toCsv(['Name'], [['a,b'], ['say "hi"'], ['two\nlines']]));
    expect(csv).toBe('Name\r\n"a,b"\r\n"say ""hi"""\r\n"two\nlines"\r\n');
  });

  it('neutralises spreadsheet formulas in text cells', () => {
    const csv = body(toCsv(['Name'], [['=1+1'], ['+1'], ['-1'], ['@x'], ['\tx'], ['normal']]));
    expect(csv.split('\r\n')).toEqual(['Name', "'=1+1", "'+1", "'-1", "'@x", "'\tx", 'normal', '']);
  });

  it('leaves trusted numeric cells untouched, including negatives', () => {
    const csv = body(toCsv(['N'], [[new Raw('-1.50')], ['-1.50']]));
    expect(csv.split('\r\n')).toEqual(['N', '-1.50', "'-1.50", '']);
  });
});
