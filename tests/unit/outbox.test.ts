import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../../supabase/functions/_shared/domain.ts';
import { db, type OutboxOp } from '../../src/lib/db';
import { discardOp } from '../../src/lib/outbox';

vi.mock('../../src/lib/api', () => ({
  api: vi.fn(),
  ApiError: class extends Error {
    status = 0;
    code = 'NETWORK';
    details = undefined;
    get retryable() { return true; }
  },
}));

const baseOp = (patch: Partial<OutboxOp>): OutboxOp => ({
  id: 'op-id', estate_id: 'estate', created_at: '2026-10-12T00:00:00Z', kind: 'api', method: 'POST',
  path: '/estates/estate/test', body: {}, entity_id: 'item', label: 'test', status: 'failed', attempts: 1,
  ...patch,
});

describe('discarding rejected local changes', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([
      db.outbox.clear(), db.items.clear(), db.grab_rounds.clear(), db.proposal_decisions.clear(),
      db.redactions.clear(), db.duplicate_reviews.clear(),
    ]);
  });

  it('removes a rejected grab round', async () => {
    await db.grab_rounds.put({ id: 'round', estate_id: 'estate', item_id: 'item', mode: 'OPEN', reveal_at: null, note: null, opened_by: 'user', created_at: '2026-10-12T00:00:00Z' });
    const seq = await db.outbox.add(baseOp({ path: '/estates/estate/items/item/grab-rounds', body: { id: 'round' } }));

    await discardOp(seq);

    expect(await db.grab_rounds.get('round')).toBeUndefined();
  });

  it('removes a rejected proposal decision', async () => {
    await db.proposal_decisions.put({ id: 'decision', estate_id: 'estate', proposal_id: 'proposal', user_id: 'user', decision: 'APPROVE', comment: null, created_at: '2026-10-12T00:00:00Z' });
    const seq = await db.outbox.add(baseOp({ id: 'decision', method: 'PUT', path: '/estates/estate/proposals/proposal/decision' }));

    await discardOp(seq);

    expect(await db.proposal_decisions.get('decision')).toBeUndefined();
  });

  it('removes a rejected photo redaction', async () => {
    await db.redactions.put({ id: 'redaction', estate_id: 'estate', media_id: 'media', reason: 'mistake', redacted_by: 'user', created_at: '2026-10-12T00:00:00Z' });
    const seq = await db.outbox.add(baseOp({ id: 'redaction', path: '/estates/estate/media/media/redact' }));

    await discardOp(seq);

    expect(await db.redactions.get('redaction')).toBeUndefined();
  });

  it('removes a rejected duplicate review and restores the prior item status', async () => {
    const item = { id: 'item', estate_id: 'estate', status: 'MERGED', merged_into_id: 'other' } as Item;
    await db.items.put(item);
    await db.duplicate_reviews.put({
      id: 'review', estate_id: 'estate', item_id: 'item', other_item_id: 'other', verdict: 'SAME_ITEM',
      reasons: [], note: null, decided_by: 'user', created_at: '2026-10-12T00:00:00Z',
    });
    const seq = await db.outbox.add(baseOp({
      path: '/estates/estate/duplicates/review',
      body: { id: 'review' },
      rollback: { item: { status: 'DISCOVERED', merged_into_id: null } },
    }));

    await discardOp(seq);

    expect(await db.duplicate_reviews.get('review')).toBeUndefined();
    expect((await db.items.get('item'))?.status).toBe('DISCOVERED');
    expect((await db.items.get('item'))?.merged_into_id).toBeNull();
  });
});
