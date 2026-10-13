import { describe, expect, it } from 'vitest';
import { generateEstateCode, isValidEstateCode } from '../../supabase/functions/_shared/estate-code.ts';

const p = { decedentSsnHash: 'a'.repeat(64), jurisdictionCode: 'NJ', createdAtTimestamp: Date.UTC(2026, 9, 13) };

describe('estate code', () => {
  it('has the EST-YYYY-HEX8 format', async () => {
    const code = await generateEstateCode(p);
    expect(code).toMatch(/^EST-2026-[0-9A-F]{8}$/);
    expect(isValidEstateCode(code)).toBe(true);
  });
  it('is deterministic and input sensitive', async () => {
    expect(await generateEstateCode(p)).toBe(await generateEstateCode({ ...p }));
    expect(await generateEstateCode(p)).not.toBe(await generateEstateCode({ ...p, jurisdictionCode: 'NY' }));
  });
  it('matches a known SHA-256 prefix', async () => {
    const code = await generateEstateCode({ decedentSsnHash: 'x', jurisdictionCode: 'y', createdAtTimestamp: 0 });
    expect(code.startsWith('EST-1970-')).toBe(true);
  });
  it('rejects bad codes', () => {
    expect(isValidEstateCode('EST-2026-abcdef12')).toBe(false);
  });
});
