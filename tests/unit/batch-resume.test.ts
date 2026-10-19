import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureItem, type CaptureInput } from '../../src/lib/actions';
import { db, deviceId } from '../../src/lib/db';
import type { Member, NumberReservation } from '../../supabase/functions/_shared/domain.ts';
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'user' } } } }) } } }));
vi.mock('../../src/lib/outbox', () => ({
  nudge: vi.fn(),
  newOp: (op: Record<string, unknown>) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), status: 'pending', attempts: 0, ...op }),
}));
const input: CaptureInput = { captureKey: 'same-batch-row', estateId: 'estate', title: 'Unnamed item (see photo)', category: 'MSC', quantity: 1, foundLocationId: null, locationId: null, photos: [], duplicateChecks: [], nextStep: { type: 'review' } };
beforeEach(async () => {
  await db.open();
  await Promise.all([db.items.clear(), db.drafts.clear(), db.meta.clear(), db.outbox.clear(), db.number_reservations.clear(), db.number_voids.clear(), db.members.clear()]);
});
describe('resuming a batch after interruption', () => {
  it('keeps only one draft when the same row is saved twice offline', async () => {
    const first = await captureItem(input);
    const second = await captureItem(input);
    expect(first).toEqual(second); expect(await db.drafts.count()).toBe(1);
  });
  it('reuses the captured item and queues its creation only once', async () => {
    const device = await deviceId();
    await db.members.put({ estate_id: 'estate', user_id: 'user', member_code: 'KB' } as Member);
    await db.number_reservations.put({ id: 'reservation', estate_id: 'estate', user_id: 'user', device_id: device, first_number: 1, last_number: 20 } as NumberReservation);
    const first = await captureItem(input);
    const second = await captureItem(input);
    expect(first.kind).toBe('item'); expect(first).toEqual(second);
    expect(await db.items.count()).toBe(1); expect(await db.outbox.count()).toBe(1);
  });
  it('refuses to reuse a capture key from another estate', async () => {
    await captureItem(input);
    await expect(captureItem({ ...input, estateId: 'other' })).rejects.toThrow('another estate');
  });
});
