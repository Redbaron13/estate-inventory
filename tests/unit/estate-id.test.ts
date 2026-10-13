import { describe, expect, it } from 'vitest';
import { generateEstateId, isValidEstateId } from '../../supabase/functions/_shared/estate-id.ts';

const dod = '2026-10-01T12:00:00Z';

describe('estate id', () => {
  it('is 18 characters and self-validates', () => {
    const id = generateEstateId(dod, 'Mary-Ann', "O'Brien", 7);
    expect(id).toHaveLength(18);
    expect(isValidEstateId(id)).toBe(true);
    expect(id.slice(5, 10)).toBe('OBRMA');
  });
  it('pads short names with X', () => {
    expect(generateEstateId(dod, 'Al', 'Li', 1).slice(5, 10)).toBe('LIALX');
  });
  it('uses reverse alphabetical tiers', () => {
    expect(generateEstateId(dod, 'A', 'Bee', 1234).slice(10, 14)).toBe('Y234');
    expect(generateEstateId(dod, 'A', 'Bee', 5).slice(10, 14)).toBe('Z005');
    expect(generateEstateId(dod, 'A', 'Bee', 5, true).slice(10, 14)).toBe('A005');
  });
  it('rejects out-of-range input', () => {
    expect(() => generateEstateId('1990-01-01', 'A', 'B', 1)).toThrow();
    expect(() => generateEstateId(dod, 'A', 'B', 25000)).toThrow();
  });
  it('detects a changed character', () => {
    const id = generateEstateId(dod, 'A', 'Bee', 1);
    const bad = id.slice(0, 10) + (id[10] === 'Z' ? 'Y' : 'Z') + id.slice(11);
    expect(isValidEstateId(bad)).toBe(false);
  });
});
