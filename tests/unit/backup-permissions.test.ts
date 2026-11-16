import { beforeEach, expect, it, vi } from 'vitest';
import { emptyEstateData } from '../../supabase/functions/_shared/domain.ts';
import { buildBackup } from '../../src/lib/backup';
const mocks = vi.hoisted(() => ({ load: vi.fn(), session: vi.fn() }));
vi.mock('../../src/lib/db', () => ({ loadEstateData: mocks.load, db: {}, getMeta: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession: mocks.session } } }));
beforeEach(() => { mocks.load.mockResolvedValue(emptyEstateData()); mocks.session.mockResolvedValue({ data: { session: { user: { id: 'person' } } } }); });
it('refuses a local ZIP for a missing, removed or non-exporting member before gathering files', async () => {
  for (const members of [[], [{ user_id: 'person', is_active: false, can_export: true }], [{ user_id: 'person', is_active: true, can_export: false }], [{ user_id: 'other', is_active: true, can_export: true }]]) {
    mocks.load.mockResolvedValue({ ...emptyEstateData(), members });
    await expect(buildBackup('estate', { includeFullPhotos: false })).rejects.toThrow('does not include backups');
  }
});
it('refuses a local ZIP without a signed-in session', async () => {
  mocks.session.mockResolvedValue({ data: { session: null } });
  await expect(buildBackup('estate', { includeFullPhotos: false })).rejects.toThrow('does not include backups');
});
