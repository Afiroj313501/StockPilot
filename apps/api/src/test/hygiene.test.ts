import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full.split(path.sep).join('/'));
    }
  }
  return out;
}

const apiAll = sourceFiles(path.join(ROOT, 'apps/api/src'));
const webAll = sourceFiles(path.join(ROOT, 'apps/web/src'));
const apiProduction = apiAll.filter((f) => !f.endsWith('.test.ts') && !f.includes('/src/test/'));
const read = (file: string) => fs.readFileSync(file, 'utf8');

describe('source hygiene', () => {
  it('uses raw SQL only through parameterised tagged templates', () => {
    const unsafe = apiProduction.filter((f) => /\$(?:queryRawUnsafe|executeRawUnsafe)/.test(read(f)));
    expect(unsafe, 'Unsafe raw SQL helpers are not allowed in application code').toEqual([]);

    let all = 0;
    let safe = 0;
    for (const file of apiProduction) {
      const text = read(file);
      all += (text.match(/(?<!['"])\$(?:queryRaw|executeRaw)\b/g) ?? []).length;
      safe += (
        text.match(
          /(?<!['"])\$(?:queryRaw|executeRaw)(?:<[^`(]*?>)?\s*(?:`|\(\s*Prisma\.sql\s*`)/g,
        ) ?? []
      ).length;
    }
    expect(all).toBeGreaterThan(0);
    expect(safe, 'Every raw query must be a tagged template or Prisma.sql, never built from strings').toBe(all);
  });

  it('avoids dangerous browser and runtime APIs, and browser storage', () => {
    const banned: [string, RegExp][] = [
      ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
      ['innerHTML assignment', /\.innerHTML\s*=/],
      ['eval()', /\beval\s*\(/],
      ['new Function()', /new Function\s*\(/],
      ['document.write()', /document\.write\s*\(/],
    ];
    const problems: string[] = [];
    for (const file of [...apiAll, ...webAll]) {
      if (file.endsWith('/hygiene.test.ts')) continue;
      const text = read(file);
      for (const [name, pattern] of banned) if (pattern.test(text)) problems.push(`${file}: ${name}`);
    }
    for (const file of webAll) {
      if (/\b(?:localStorage|sessionStorage)\b/.test(read(file))) {
        problems.push(`${file}: browser storage (sessions use an HttpOnly cookie; if you need it for harmless preferences, update this test)`);
      }
    }
    expect(problems).toEqual([]);
  });
});
