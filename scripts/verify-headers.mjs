// Checks that a deployed site sends the security headers in public/_headers.
//   node scripts/verify-headers.mjs https://example.com/
// Exits 1 if a header is missing or weaker than the reviewed policy.
// GitHub Pages can't send headers. Set ALLOW_META_CSP=1 to accept the
// Content Security Policy from a <meta> tag instead (the other headers are
// then reported as warnings, not failures).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REQUIRED = [
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Cross-Origin-Opener-Policy',
  'Strict-Transport-Security',
];
const FORBIDDEN_SOURCES = ["'unsafe-eval'", "'unsafe-inline'", 'http:', '*'];
const META_IGNORED = ['frame-ancestors'];

export function expectedHeaders(text) {
  const out = {};
  const block = text.split(/\r?\n\r?\n/)[0];
  for (const line of block.split(/\r?\n/)) {
    const m = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

export function parseCsp(csp) {
  const map = new Map();
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name.toLowerCase(), values);
  }
  return map;
}

// Returns a list of problems; empty means the policy is at least as strict.
export function cspProblems(actual, expected, { meta = false } = {}) {
  const problems = [];
  const have = parseCsp(actual);
  for (const [name, want] of parseCsp(expected)) {
    if (meta && META_IGNORED.includes(name)) continue;
    const got = have.get(name);
    if (!got) {
      problems.push(`CSP directive missing: ${name}`);
      continue;
    }
    for (const value of got) {
      if (!want.includes(value)) problems.push(`CSP ${name} allows extra source: ${value}`);
    }
  }
  for (const [name, values] of have) {
    if (name === 'style-src') continue;
    for (const v of values) if (FORBIDDEN_SOURCES.includes(v) && !(parseCsp(expected).get(name) ?? []).includes(v)) problems.push(`CSP ${name} uses ${v}`);
  }
  return problems;
}

export function metaCsp(html) {
  const tag = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(html)?.[0];
  return tag ? /content=(["'])(.*?)\1/i.exec(tag)?.[2] : undefined;
}

export function headerProblems(headers, expected, { html = '', allowMeta = false } = {}) {
  const problems = [];
  const warnings = [];
  for (const name of REQUIRED) {
    const want = expected[name.toLowerCase()];
    if (!want) continue;
    const got = headers.get(name);
    const key = name.toLowerCase();
    if (key === 'content-security-policy') {
      if (got) {
        problems.push(...cspProblems(got, want));
        continue;
      }
      const meta = allowMeta ? metaCsp(html) : undefined;
      if (meta) {
        warnings.push('CSP enforced only through a meta tag (no response header)');
        problems.push(...cspProblems(meta, want, { meta: true }));
      } else problems.push(`Missing header: ${name}`);
      continue;
    }
    if (!got) {
      if (allowMeta) warnings.push(`Missing header: ${name}`);
      else problems.push(`Missing header: ${name}`);
    } else if (key === 'strict-transport-security') {
      const age = Number(/max-age=(\d+)/i.exec(got)?.[1] ?? 0);
      if (age < Number(/max-age=(\d+)/i.exec(want)?.[1] ?? 0)) problems.push(`Weakened header: ${name}: ${got}`);
    } else if (got.trim().toLowerCase() !== want.toLowerCase()) problems.push(`Changed header: ${name}: ${got}`);
  }
  return { problems, warnings };
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/verify-headers.mjs <url>');
    process.exit(2);
  }
  const expected = expectedHeaders(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'));
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    console.error(`${url} returned HTTP ${res.status}`);
    process.exit(1);
  }
  if (new URL(res.url).protocol !== 'https:') {
    console.error(`${res.url} is not served over HTTPS`);
    process.exit(1);
  }
  const { problems, warnings } = headerProblems(res.headers, expected, {
    html: await res.text(),
    allowMeta: process.env.ALLOW_META_CSP === '1',
  });
  for (const w of warnings) console.warn(`::warning::${w}`);
  for (const p of problems) console.error(`::error::${p}`);
  if (problems.length) process.exit(1);
  console.log(`Security headers verified for ${url}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
