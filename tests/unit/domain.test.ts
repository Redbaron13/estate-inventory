import { describe, expect, it } from 'vitest';
import {
  emptyEstateData, findDuplicateCandidates, proposalView, referenceValue, roundView, similarity,
  type EstateData, type Item, type Member, type Proposal,
} from '../../supabase/functions/_shared/domain.ts';
import { toCSV } from '../../supabase/functions/_shared/reports.ts';

const T = '2026-10-11T12:00:00Z';
const member = (user_id: string, role: Member['role'] = 'BENEFICIARY'): Member => ({
  estate_id: 'e', user_id, role, member_code: user_id.slice(0, 2).toUpperCase(), can_add_items: true, can_edit_items: true,
  can_propose: true, can_approve: true, can_export: true, is_active: true, invited_by: null, joined_at: T, removed_at: null,
  removed_by: null, removal_reason: null, updated_at: T,
});
const item = (id: string, title: string, extra: Partial<Item> = {}): Item => ({
  id, estate_id: 'e', inventory_number: Number(id.replace(/\D/g, '')) || 1, item_code: '0001AA-XX0MSC-AAA', title,
  description: null, category: 'MSC', quantity: 1, condition: null, barcode: null, barcode_format: null, brand: null, model: null,
  serial_number: null, dimensions: null, weight: null, markings: null, provenance: null, notes: null,
  original_location_id: null, current_location_id: null, status: 'DISCOVERED', potentially_valuable: false, do_not_move: false,
  do_not_move_reason: null, physically_verified_at: null, physically_verified_by: null, merged_into_id: null, device_id: null,
  captured_at: null, created_by: 'ann', created_at: T, updated_by: null, updated_at: T, version: 1, ...extra,
});

function withProposal(rule: Proposal['rule'], eligible: string[], decisions: [string, 'APPROVE' | 'REJECT' | 'ABSTAIN'][]): EstateData {
  const d = emptyEstateData();
  d.members = ['ann', 'ben', 'cat'].map((u) => member(u));
  d.proposals = [{ id: 'p', estate_id: 'e', item_id: 'i1', action: 'DONATE', recipient_user_id: null, recipient_name: null, amount: null, organization: null, reason: null, rule, eligible_approvers: eligible, auto_approved: false, requested_by: 'ann', created_at: T }];
  d.proposal_decisions = decisions.map(([user_id, decision], n) => ({ id: `d${n}`, estate_id: 'e', proposal_id: 'p', user_id, decision, comment: null, created_at: `2026-10-11T12:0${n}:00Z` }));
  return d;
}

describe('proposal state (mirrors the database rule)', () => {
  it('majority: waits until more than half approve', () => {
    const d = withProposal('MAJORITY', ['ann', 'ben', 'cat'], [['ann', 'APPROVE']]);
    const v = proposalView(d.proposals[0], d);
    expect(v.approvals).toBe(1);
    expect(v.waitingOn).toEqual(['ben', 'cat']);
  });

  it('only the latest decision of each person counts, and set-aside decisions do not', () => {
    const d = withProposal('UNANIMOUS', ['ann', 'ben'], [['ann', 'REJECT'], ['ann', 'APPROVE'], ['ben', 'APPROVE']]);
    d.decision_invalidations = [{ decision_id: 'd2', estate_id: 'e', proposal_id: 'p', reason: 'x', invalidated_by: 'ann', created_at: T }];
    const v = proposalView(d.proposals[0], d);
    expect(v.effective.get('ann')?.decision).toBe('APPROVE');
    expect(v.effective.has('ben')).toBe(false);
    expect(v.waitingOn).toEqual(['ben']);
  });

  it('removed members drop out of the approver count', () => {
    const d = withProposal('UNANIMOUS', ['ann', 'ben', 'cat'], []);
    d.members[2].is_active = false;
    expect(proposalView(d.proposals[0], d).eligible).toEqual(['ann', 'ben']);
  });
});

describe('sealed rounds', () => {
  it('are sealed before the reveal time and open after', () => {
    const d = emptyEstateData();
    d.members = [member('ann'), member('ben')];
    const round = { id: 'r', estate_id: 'e', item_id: 'i1', mode: 'SEALED' as const, reveal_at: '2026-10-12T12:00:00Z', note: null, opened_by: 'ann', created_at: T };
    d.grab_rounds = [round];
    d.claims = [{ id: 'c', estate_id: 'e', round_id: 'r', item_id: 'i1', user_id: 'ben', interest: 'INTERESTED', note: null, created_at: T }];
    expect(roundView(round, d, 'ben', new Date('2026-10-11T13:00:00Z')).sealed).toBe(true);
    const after = roundView(round, d, 'ann', new Date('2026-10-12T13:00:00Z'));
    expect(after.sealed).toBe(false);
    expect(after.interested).toEqual(['ben']);
    expect(after.myClaim).toBeNull();
  });
});

describe('values', () => {
  it('uses the most authoritative current value, not asking prices or superseded ones', () => {
    const v = (id: string, type: any, amount: number, supersedes: string | null = null) => ({
      id, estate_id: 'e', item_id: 'i1', valuation_type: type, amount, currency: 'USD', valuation_date: '2026-10-01',
      source: null, appraiser_name: null, comparable_url: null, notes: null, attachment_media_id: null,
      supersedes_id: supersedes, entered_by: 'ann', created_at: T,
    });
    const vals = [v('a', 'FAMILY_ESTIMATE', 100), v('b', 'LISTING_PRICE', 900), v('c', 'FORMAL_APPRAISAL', 400), v('d', 'FORMAL_APPRAISAL', 450, 'c')];
    expect(referenceValue('i1', vals)).toEqual({ amount: 450, type: 'FORMAL_APPRAISAL' });
  });
});

describe('duplicate detection', () => {
  it('finds same barcode, same serial, and similar names', () => {
    const d = emptyEstateData();
    d.items = [
      item('i1', 'Kitchen mixer', { barcode: '0050946872667' }),
      item('i2', 'Cordless drill', { serial_number: 'DW-77812' }),
      item('i3', 'Grandfather clock'),
    ];
    expect(findDuplicateCandidates({ title: 'Stand mixer', barcode: '0050946872667' }, d)[0].reasons).toContain('BARCODE');
    expect(findDuplicateCandidates({ title: 'Drill', serial_number: 'dw 77812' }, d)[0].reasons).toContain('SERIAL');
    expect(findDuplicateCandidates({ title: 'Grandfather clock (oak)' }, d)[0].item.id).toBe('i3');
    expect(findDuplicateCandidates({ title: 'Sewing machine' }, d)).toHaveLength(0);
  });

  it('ignores merged records', () => {
    const d = emptyEstateData();
    d.items = [item('i1', 'Blue lamp', { status: 'MERGED' })];
    expect(findDuplicateCandidates({ title: 'Blue lamp' }, d)).toHaveLength(0);
  });

  it('similarity behaves like trigram matching', () => {
    expect(similarity('brass lamp', 'brass lamp')).toBe(1);
    expect(similarity('brass lamp', 'oak table')).toBeLessThan(0.2);
  });
});

describe('CSV', () => {
  it('escapes commas, quotes and new lines and starts with a BOM for Excel', () => {
    const csv = toCSV({ title: 't', headers: ['a', 'b'], rows: [['x, y', 'say "hi"\nthere']] });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"x, y","say ""hi""\nthere"');
  });
});
