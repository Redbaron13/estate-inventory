// Sync engine: push queued changes, pull everyone else's, keep a block of
// inventory numbers on hand for offline capture, and check the shared history
// against what this phone has seen before.
//
// iPhones do not let web apps sync in the background, so this runs whenever
// the app is open: at start, when the connection returns, when the app comes
// back to the foreground, every minute while open, and when another member
// changes something (realtime signal).
import type { RealtimeChannel } from '@supabase/supabase-js';
import { verifyChain, GENESIS_HASH } from '../../supabase/functions/_shared/ledger.ts';
import type { LedgerEntry } from '../../supabase/functions/_shared/domain.ts';
import { api, ApiError } from './api';
import { MEDIA_BUCKET, NUMBER_POOL_MIN, NUMBER_POOL_REFILL } from './config';
import { db, deviceId, getMeta, setMeta, SYNC_TABLES, type MyEstate } from './db';
import { flushOutbox, onEnqueue } from './outbox';
import { supabase } from './supabase';
import { convertDrafts, availableNumbers } from './actions';
import { recordDiagnostic } from './diagnostics';

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  problems: number;
  lastSyncAt: string | null;
  lastError: string | null;
  needsSignIn: boolean;
  historyAlert: boolean;
}

let state: SyncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  problems: 0,
  lastSyncAt: null,
  lastError: null,
  needsSignIn: false,
  historyAlert: false,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getSyncState() {
  return state;
}
export function subscribeSync(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function refreshCounts() {
  const [pending, problems, drafts] = await Promise.all([
    db.outbox.where('status').equals('pending').count(),
    db.outbox.where('status').anyOf('failed', 'conflict').count(),
    db.drafts.count(),
  ]);
  const alerts = (await db.meta.where('key').startsWith('ledger_alert:').toArray()).filter((m) => m.value);
  setState({ pending: pending + drafts, problems, historyAlert: alerts.length > 0 });
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------
export async function refreshMyEstates(): Promise<MyEstate[]> {
  const me = await api<{ profile: any; estates: MyEstate[] }>('/me');
  await db.transaction('rw', db.myEstates, db.profiles, db.meta, async () => {
    await db.myEstates.clear();
    await db.myEstates.bulkPut(me.estates);
    if (me.profile) await db.profiles.put({ id: me.profile.id, display_name: me.profile.display_name, email: me.profile.email, phone: me.profile.phone });
    await db.meta.put({ key: 'my_profile', value: me.profile });
  });
  return me.estates;
}

export async function pullEstate(estateId: string): Promise<void> {
  const since = await getMeta<string>(`cursor:${estateId}`, '0');
  const data = await api<Record<string, any>>(`/estates/${estateId}/sync?since=${encodeURIComponent(since)}`);
  const tables = Object.entries(SYNC_TABLES).map(([, t]) => (db as any)[t]);
  await db.transaction('rw', [db.estates, db.meta, ...tables], async () => {
    for (const e of data.estates ?? []) await db.estates.put(e);
    for (const [key, table] of Object.entries(SYNC_TABLES)) {
      const rows = data[key];
      if (Array.isArray(rows) && rows.length) await (db as any)[table].bulkPut(rows);
    }
    await db.meta.put({ key: `cursor:${estateId}`, value: data.cursor });
    await db.meta.put({ key: `head:${estateId}`, value: data.ledger_head ?? null });
    await db.meta.put({ key: `pulled_at:${estateId}`, value: new Date().toISOString() });
  });
}

// ---------------------------------------------------------------------------
// Inventory numbers
// ---------------------------------------------------------------------------
async function ensureNumbers(estate: MyEstate) {
  if (!estate.my_permissions?.can_add_items) return;
  const available = await availableNumbers(estate.id);
  if (available.length >= NUMBER_POOL_MIN) return;
  const reservation = await api(`/estates/${estate.id}/inventory-numbers/reserve`, {
    method: 'POST',
    body: { device_id: await deviceId(), count: NUMBER_POOL_REFILL },
    idempotencyKey: crypto.randomUUID(),
  });
  await db.number_reservations.put(reservation);
}

// ---------------------------------------------------------------------------
// History check: this phone is a witness. It keeps the latest fingerprint it
// has verified and checks that new history continues from it.
// ---------------------------------------------------------------------------
async function checkHistory(estateId: string) {
  const last = await db.witnesses.where('estate_id').equals(estateId).last();
  const start = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH };
  const entries: LedgerEntry[] = [];
  let after = start.seq;
  for (let guard = 0; guard < 100; guard++) {
    const page = await api<{ entries: LedgerEntry[] }>(`/estates/${estateId}/ledger?after_seq=${after}&limit=2000`);
    entries.push(...page.entries);
    if (page.entries.length < 2000) break;
    after = page.entries[page.entries.length - 1].estate_seq;
  }
  if (!entries.length) return;
  const result = await verifyChain(entries, start);
  if (!result.ok) {
    await setMeta(`ledger_alert:${estateId}`, {
      at: new Date().toISOString(),
      problem: result.problem,
      witnessed: last ?? null,
    });
    void recordDiagnostic('error', 'sync', 'LEDGER_MISMATCH', 'The shared history does not match this phone’s last verified record.');
    return;
  }
  await db.witnesses.put({ estate_id: estateId, seq: result.head.seq, hash: result.head.hash, seen_at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Photos: keep every thumbnail on the phone so the inventory is browsable offline.
// ---------------------------------------------------------------------------
async function prefetchThumbnails(estateId: string, limit = 150) {
  const media = await db.media.where('estate_id').equals(estateId).toArray();
  const redacted = new Set((await db.redactions.where('estate_id').equals(estateId).toArray()).map((r) => r.media_id));
  const wanted = media.filter((m) => m.thumb_sha256 && m.thumb_path && !redacted.has(m.id));
  const have = new Set((await db.blobs.where('sha256').anyOf(wanted.map((m) => m.thumb_sha256!)).primaryKeys()) as string[]);
  const todo = wanted.filter((m) => !have.has(m.thumb_sha256!)).slice(0, limit);
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const m = todo[i++];
      const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(m.thumb_path!);
      if (error || !data) continue;
      await db.blobs.put({ sha256: m.thumb_sha256!, estate_id: estateId, blob: data, mime_type: 'image/jpeg', role: 'thumb', uploaded: true, created_at: new Date().toISOString() });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// ---------------------------------------------------------------------------
// Realtime nudges
// ---------------------------------------------------------------------------
const channels = new Map<string, RealtimeChannel>();

async function watchEstates(ids: string[]) {
  try {
    await supabase.realtime.setAuth();
  } catch {
    return;
  }
  for (const id of ids) {
    if (channels.has(id)) continue;
    const ch = supabase
      .channel(`estate:${id}`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, () => requestSync('realtime'))
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void recordDiagnostic('warning', 'sync', 'REALTIME_UNAVAILABLE', 'Live updates are unavailable; periodic sync will continue.');
        }
      });
    channels.set(id, ch);
  }
}

export function stopWatching() {
  for (const ch of channels.values()) supabase.removeChannel(ch);
  channels.clear();
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function requestSync(_reason = 'manual', delay = 400) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delay);
}

export async function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    await refreshCounts();
    if (!navigator.onLine) {
      setState({ online: false });
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setState({ needsSignIn: true });
      return;
    }
    setState({ syncing: true, online: true, lastError: null });
    try {
      const pushed = await flushOutbox();
      if (pushed.needsSignIn) {
        setState({ needsSignIn: true });
        return;
      }
      const estates = await refreshMyEstates();
      for (const estate of estates) {
        await pullEstate(estate.id);
        await ensureNumbers(estate).catch(() => {
          void recordDiagnostic('warning', 'sync', 'NUMBER_RESERVATION_FAILED', 'New item numbers could not be reserved; offline captures may stay as drafts.');
        });
        await convertDrafts(estate.id).catch(() => {
          void recordDiagnostic('warning', 'sync', 'DRAFT_CONVERSION_FAILED', 'Some offline item drafts could not be numbered.');
        });
      }
      // Drafts converted to items need pushing too.
      await flushOutbox();
      setState({ lastSyncAt: new Date().toISOString(), needsSignIn: false });
      void watchEstates(estates.map((e) => e.id));
      for (const estate of estates) {
        await checkHistory(estate.id).catch(() => {
          void recordDiagnostic('warning', 'sync', 'LEDGER_CHECK_FAILED', 'The shared history could not be checked.');
        });
        void prefetchThumbnails(estate.id).catch(() => undefined);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Sync failed.';
      void recordDiagnostic('error', 'sync', e instanceof ApiError ? e.code : 'SYNC_FAILED', 'Sync could not complete. Check connection, sign-in, and service availability.');
      setState({ lastError: msg, needsSignIn: e instanceof ApiError && e.status === 401 });
    } finally {
      setState({ syncing: false });
      await refreshCounts();
    }
  })();
  try {
    await running;
  } finally {
    running = null;
    if (again) {
      again = false;
      requestSync('again', 1000);
    }
  }
}

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  onEnqueue(() => {
    void refreshCounts();
    requestSync('enqueue', 300);
  });
  window.addEventListener('online', () => {
    setState({ online: true });
    requestSync('online', 200);
  });
  window.addEventListener('offline', () => setState({ online: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync('visible', 200);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') requestSync('interval', 0);
  }, 60000);
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') requestSync('auth', 100);
    if (event === 'SIGNED_OUT') stopWatching();
  });
  requestSync('start', 50);
}
