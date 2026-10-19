import { describe, expect, it } from 'vitest';
import { emptyEstateData, type Item, type Member } from '../../supabase/functions/_shared/domain.ts';
import { beneficiarySummaryReport, familyChoicesReport } from '../../src/lib/family-reports';
const t = '2026-10-19T00:00:00Z';
const item = { id: 'item', inventory_number: 1, item_code: 'code', title: 'Lamp', status: 'DISCOVERED', original_location_id: null } as Item;
const member = (id: string) => ({ user_id: id, role: 'BENEFICIARY', is_active: true }) as Member;
describe('family report privacy and completeness', () => {
  it('withholds locally cached answers and notes until reveal', () => {
    const d = emptyEstateData(); d.items = [item]; d.members = [member('a'), member('b')];
    d.grab_rounds = [{ id: 'r', estate_id: 'e', item_id: 'item', mode: 'SEALED', reveal_at: '2026-10-20T00:00:00Z', opened_by: 'a', created_at: t, note: null }];
    d.claims = [{ id: 'c', estate_id: 'e', round_id: 'r', item_id: 'item', user_id: 'a', interest: 'NEED_INFO', note: 'Private note', created_at: t }];
    const sealed = familyChoicesReport(d, new Date(t));
    expect(sealed.rows.every(r => r[6] === 'Sealed until reveal' && r[7] === '')).toBe(true);
    const revealed = familyChoicesReport(d, new Date('2026-10-21'));
    expect(revealed.rows[0][6]).toBe('Discuss first'); expect(revealed.rows[0][7]).toBe('Private note');
    expect(revealed.rows[1][6]).toBe('No response recorded');
  });
  it('does not mistake not-yet-asked for disinterest', () => {
    const d = emptyEstateData(); d.items = [item]; d.members = [member('a')];
    expect(familyChoicesReport(d).rows[0][6]).toBe('Not opened for family choices');
  });
  it('keeps two beneficiaries with the same display name separate', () => {
    const d = emptyEstateData(); d.members = [member('a'), member('b')];
    d.profiles = [{ id: 'a', display_name: 'Alex' }, { id: 'b', display_name: 'Alex' }] as typeof d.profiles;
    const report = beneficiarySummaryReport(d);
    expect(report.rows.length).toBe(2); expect(report.rows.map(r => r[1])).toEqual(['a', 'b']);
  });
});
