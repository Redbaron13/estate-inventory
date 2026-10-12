import { describe, expect, it } from 'vitest';
import {
  CATEGORY_CODES, checkDigit, classifyScan, deriveLocationTag, isValidItemCode, isValidLocationCode,
  makeItemCode, makeLocationCode, parseItemCode, parseLocationCode,
} from '../../supabase/functions/_shared/codes.ts';
import sqlCodes from './fixtures/sql-codes.json';

describe('item codes', () => {
  it('builds number+member, room+check+category, random', () => {
    const code = makeItemCode({ inventoryNumber: 428, memberCode: 'KB', foundTag: 'LR', category: 'FUR' });
    expect(code).toMatch(/^0428KB-LR\dFUR-[0-9A-HJKMNP-TV-Z]{3}$/);
    expect(isValidItemCode(code)).toBe(true);
  });

  it('grows past 9999 without truncating', () => {
    const code = makeItemCode({ inventoryNumber: 12345, memberCode: 'DB', foundTag: 'B2', category: 'TLS' });
    expect(code.startsWith('12345DB-B2')).toBe(true);
    expect(parseItemCode(code)?.inventoryNumber).toBe(12345);
  });

  it('accepts codes typed without dashes, in lower case, with spaces', () => {
    const code = makeItemCode({ inventoryNumber: 7, memberCode: 'BB', foundTag: 'KT', category: 'KIT' });
    const typed = code.replace(/-/g, ' ').toLowerCase();
    expect(parseItemCode(typed)?.code).toBe(code);
  });

  it('rejects every single-character typo in the check digit', () => {
    const code = makeItemCode({ inventoryNumber: 31, memberCode: 'KB', foundTag: 'LR', category: 'ART' });
    const pos = code.indexOf('-') + 3;
    for (let d = 0; d <= 9; d++) {
      const typo = code.slice(0, pos) + d + code.slice(pos + 1);
      expect(isValidItemCode(typo)).toBe(typo === code);
    }
  });

  it('catches most swapped neighbors', () => {
    let caught = 0, total = 0;
    for (let n = 1; n < 300; n++) {
      const code = makeItemCode({ inventoryNumber: n, memberCode: 'KB', foundTag: 'LR', category: 'FUR' });
      const c = code.replace(/-/g, '');
      for (let i = 0; i < c.length - 1; i++) {
        if (c[i] === c[i + 1]) continue;
        const swapped = c.slice(0, i) + c[i + 1] + c[i] + c.slice(i + 2);
        total++;
        if (parseItemCode(swapped)?.code !== code) caught++;
      }
    }
    expect(caught / total).toBeGreaterThan(0.9);
  });

  it('never issues a check value of 10', () => {
    for (let i = 0; i < 500; i++) {
      const code = makeItemCode({ inventoryNumber: i + 1, memberCode: 'AA', foundTag: 'XX', category: 'MSC' });
      expect(parseItemCode(code)).not.toBeNull();
    }
  });

  it('agrees with every code the database generated', () => {
    for (const code of sqlCodes.items as string[]) expect(isValidItemCode(code), code).toBe(true);
  });

  it('knows every category the database allows', () => {
    expect(CATEGORY_CODES).toContain('MSC');
    expect(CATEGORY_CODES).toHaveLength(21);
  });
});

describe('location codes and room tags', () => {
  it('builds prefix-random with a middle check digit', () => {
    const code = makeLocationCode('CONTAINER');
    expect(code).toMatch(/^BOX-[0-9A-HJKMNP-TV-Z]{2}\d[0-9A-HJKMNP-TV-Z]{2}$/);
    expect(isValidLocationCode(code)).toBe(true);
    expect(parseLocationCode(code.toLowerCase().replace('-', ''))?.kind).toBe('CONTAINER');
  });

  it('agrees with every place code the database generated', () => {
    for (const l of sqlCodes.locations as { code: string }[]) expect(isValidLocationCode(l.code), l.code).toBe(true);
  });

  it('derives readable room tags and avoids ones in use', () => {
    expect(deriveLocationTag('Living room')).toBe('LR');
    expect(deriveLocationTag('Bedroom 2')).toBe('B2');
    expect(deriveLocationTag('Kitchen')).toBe('KT');
    expect(deriveLocationTag('Basement')).toBe('BS');
    expect(deriveLocationTag('Bathroom', ['BT', 'BA'])).not.toMatch(/^(BT|BA)$/);
  });

  it('matches the database for the same names', () => {
    for (const l of sqlCodes.locations as { name: string; tag: string; kind: string }[]) {
      if (l.kind === 'AREA') expect(deriveLocationTag(l.name), l.name).toBe(l.tag);
    }
  });
});

describe('scan classification', () => {
  it('tells item labels, place labels and product barcodes apart', () => {
    const item = makeItemCode({ inventoryNumber: 5, memberCode: 'KB', foundTag: 'LR', category: 'FUR' });
    expect(classifyScan(item).type).toBe('item');
    expect(classifyScan(makeLocationCode('STAGING')).type).toBe('location');
    expect(classifyScan('0050946872667').type).toBe('barcode');
  });

  it('check digit is weighted (order matters)', () => {
    expect(checkDigit('AB')).not.toBe(checkDigit('BA'));
  });
});
