#!/usr/bin/env node
// Scans the files tracked by Git for secrets. No dependencies.
//   node scripts/scan-secrets.mjs               scan the repository (exit code 1 if anything is found)
//   node scripts/scan-secrets.mjs --self-test   check that the scanner itself still works
// This looks at the files as they are now. To check old commits too, run gitleaks (see docs/SECURITY_REVIEW.md).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['OpenAI or Anthropic style key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['Groq key', /\bgsk_[A-Za-z0-9]{20,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Database URL with a password', /postgres(?:ql)?:\/\/[^:\s/]+:([^@\s]+)@/, 1],
  ['Hard-coded secret', /\b(?:api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*['"]([^'"\s]{12,})['"]/i, 1],
];

// Values that are obviously examples, placeholders or test data.
const PLACEHOLDER =
  /change_me|replace_with|your[-_ ]|example|placeholder|dummy|test_|xxxx|<[^>]+>|\$\{|longpassword|wrongpassword|secretpassword|hunter2|sk-test|sk-live-123/i;

const SKIP_FILE = /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|ico|webp|pdf|woff2?|ttf|zip)$/i;
const FORBIDDEN_FILES = [
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, 'Environment file with real settings'],
  [/\.(pem|key|p12|pfx)$/i, 'Key or certificate file'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, 'SSH private key'],
  [/\.(dump|bak)$/i, 'Database dump'],
];

export function scanText(text) {
  const findings = [];
  text.split('\n').forEach((line, index) => {
    if (line.length > 5000) return;
    for (const [name, pattern, group] of PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const value = group ? match[group] : match[0];
      if (PLACEHOLDER.test(value) || PLACEHOLDER.test(line)) continue;
      findings.push({
        line: index + 1,
        rule: name,
        hint: `${value.slice(0, 4)}… (${value.length} characters)`,
      });
    }
  });
  return findings;
}

function selfTest() {
  // Samples are assembled at run time so this file does not contain anything that looks like a secret.
  const positive = [
    ['Private key', '-----BEGIN ' + 'PRIVATE KEY-----'],
    ['AWS access key id', 'key=' + 'AKIA' + 'ABCDEFGHIJKLMNOP'],
    ['OpenAI or Anthropic style key', 'k = ' + 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2'],
    ['Groq key', 'k = ' + 'gsk_' + 'a1B2c3D4e5F6g7H8i9J0k1L2'],
    ['GitHub token', 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'],
    ['Database URL with a password', 'postgres://app:' + 'Zq9xT7mW2kLp' + '@db.internal/app'],
    ['Hard-coded secret', 'const apiKey = "' + 'Zq9!xT7#mW2$kL' + '";'],
  ];
  const negative = [
    'DATABASE_URL=postgresql://stockpilot:change_me@localhost:5432/stockpilot',
    "export const PASSWORD = 'LongPassword123';",
    'SESSION_SECRET=replace_with_a_long_random_string',
    "const key = 'sk-test-secret';",
    'const message = "Use at least 10 characters";',
  ];
  let failed = 0;
  for (const [rule, sample] of positive) {
    if (!scanText(sample).some((f) => f.rule === rule)) {
      console.error(`SELF-TEST FAILED: "${rule}" was not detected`);
      failed++;
    }
  }
  for (const sample of negative) {
    if (scanText(sample).length > 0) {
      console.error(`SELF-TEST FAILED: a harmless line was flagged: ${sample}`);
      failed++;
    }
  }
  if (failed > 0) process.exit(1);
  console.log('Secret scanner self-test passed.');
}

function scanRepository() {
  const files = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const problems = [];

  for (const file of files) {
    for (const [pattern, reason] of FORBIDDEN_FILES) {
      if (pattern.test(file)) problems.push(`${file}: ${reason} is tracked by Git`);
    }
    if (/\.sql$/i.test(file) && !file.startsWith('apps/api/prisma/migrations/')) {
      problems.push(`${file}: SQL file outside the migrations folder (database dumps must not be committed)`);
    }
    if (SKIP_FILE.test(file)) continue;
    let text;
    try {
      if (statSync(file).size > 1024 * 1024) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // deleted or unreadable
    }
    if (text.includes('\0')) continue; // binary
    for (const f of scanText(text)) problems.push(`${file}:${f.line}: ${f.rule} ${f.hint}`);
  }

  if (problems.length > 0) {
    console.error(`Possible secrets found (${problems.length}):`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      'If a real secret was committed: revoke it at the provider first, then remove it. Removing it from the files is not enough.',
    );
    process.exit(1);
  }
  console.log(`Checked ${files.length} tracked files: no secrets found.`);
}

if (process.argv.includes('--self-test')) selfTest();
else scanRepository();
