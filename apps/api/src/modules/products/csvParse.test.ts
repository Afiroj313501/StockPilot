import { describe, expect, it } from 'vitest';
import { CsvError, parseCsv } from './csvParse';

describe('parseCsv', () => {
  it('handles quotes, line breaks inside quotes, a BOM, blank lines and other delimiters', () => {
    const parsed = parseCsv('\uFEFFa,b\r\n"x,1","say ""hi"""\r\n"line1\nline2",z\r\n\r\n');
    expect(parsed.delimiter).toBe(',');
    expect(parsed.rows).toEqual([
      ['a', 'b'],
      ['x,1', 'say "hi"'],
      ['line1\nline2', 'z'],
    ]);
    expect(parsed.lines).toEqual([1, 2, 3]);

    expect(parseCsv('a;b\n1;2')).toMatchObject({
      delimiter: ';',
      rows: [
        ['a', 'b'],
        ['1', '2'],
      ],
    });
    expect(parseCsv('a\tb\n1\t2')).toMatchObject({
      delimiter: '\t',
      rows: [
        ['a', 'b'],
        ['1', '2'],
      ],
    });
    expect(parseCsv('a,b\n1').rows).toEqual([['a', 'b'], ['1']]);
    expect(parseCsv('a,b\n,,\n  ,\n1,2').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('').rows).toEqual([]);
  });

  it('rejects broken quoting and files over the limits, saying where', () => {
    expect(() => parseCsv('sku,name\n"A,B')).toThrow(/closing quote/);
    expect(() => parseCsv('"a"b,c')).toThrow(/after a closing quote/);
    expect(() => parseCsv('a"b,c')).toThrow(/must start a value/);
    try {
      parseCsv('sku,name\n"A,B');
    } catch (err) {
      expect(err).toBeInstanceOf(CsvError);
      expect((err as CsvError).line).toBe(2);
    }

    expect(() => parseCsv('a\n1\n2\n3', { maxRows: 2, maxColumns: 3 })).toThrow(
      /at most 2 data rows/,
    );
    expect(parseCsv('a\n1\n2', { maxRows: 2, maxColumns: 3 }).rows).toHaveLength(3);
    expect(() => parseCsv('a,b,c,d\n1', { maxRows: 2, maxColumns: 3 })).toThrow(
      /more than 3 columns/,
    );
  });
});
