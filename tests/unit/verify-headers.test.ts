import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS script
import { cspProblems, expectedHeaders, headerProblems, metaCsp } from '../../scripts/verify-headers.mjs';

import headersFile from '../../public/_headers?raw';
import vercelFile from '../../vercel.json?raw';

const file = headersFile;
const expected = expectedHeaders(file);
const csp = expected['content-security-policy'] as string;
const good = () => new Headers(expected);

describe('verify-headers', () => {
  it('accepts the reviewed headers', () => {
    expect(headerProblems(good(), expected).problems).toEqual([]);
  });
  it('flags a missing header', () => {
    const h = good();
    h.delete('Strict-Transport-Security');
    expect(headerProblems(h, expected).problems.length).toBe(1);
  });
  it('flags a weakened CSP', () => {
    expect(cspProblems(csp.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"), csp).length).toBeGreaterThan(0);
    expect(cspProblems(csp.replace("object-src 'none'; ", ''), csp).length).toBeGreaterThan(0);
  });
  it('accepts a meta CSP only when allowed', () => {
    const h = new Headers();
    const policy = csp.split(';').filter((d) => !d.includes('frame-ancestors')).join(';');
    const html = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
    expect(metaCsp(html)).toBe(policy);
    expect(headerProblems(h, expected, { html }).problems.length).toBeGreaterThan(0);
    expect(headerProblems(h, expected, { html, allowMeta: true }).problems).toEqual([]);
  });
  it('keeps vercel.json in step with _headers', () => {
    const vercel = JSON.parse(vercelFile);
    const sent = Object.fromEntries(vercel.headers[0].headers.map((x: { key: string; value: string }) => [x.key.toLowerCase(), x.value]));
    for (const k of Object.keys(sent)) expect(sent[k]).toBe(expected[k]);
  });
});
