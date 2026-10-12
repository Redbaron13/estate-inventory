// The upload queue. Every change is saved on the phone first, then sent in
// order. Nothing leaves the queue until the server confirms it.
import { api, ApiError } from './api';
import { MEDIA_BUCKET, SUPABASE_URL } from './config';
import { db, type OutboxOp } from './db';

export type NewOp = Omit<OutboxOp, 'seq' | 'id' | 'created_at' | 'status' | 'attempts'> & { id?: string };

export function newOp(op: NewOp): OutboxOp {
  return { ...op, id: op.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), status: 'pending', attempts: 0 };
}

let notify: (() => void) | null = null;
/** The sync engine registers here so new work starts uploading right away. */
export function onEnqueue(fn: () => void) {
  notify = fn;
}
export function nudge() {
  notify?.();
}

export type FlushResult = { sent: number; stoppedForNetwork: boolean; needsSignIn: boolean };

async function putSignedUpload(signedPath: string, blob: Blob, mime: string) {
  let res: Response;
  try {
    // The signed URL carries its own one-time token.
    res = await fetch(`${SUPABASE_URL}${signedPath}`, {
      method: 'PUT',
      headers: { 'Content-Type': mime, 'x-upsert': 'false' },
      body: blob,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection.');
  }
  if (res.ok) return;
  const text = await res.text();
  // Content-addressed: if the same bytes are already stored, that is success.
  if (res.status === 409 || /already exists|Duplicate/i.test(text)) return;
  throw new ApiError(res.status >= 500 ? res.status : 0, 'UPLOAD', `Upload failed (${res.status}).`);
}

async function runUpload(op: OutboxOp) {
  const u = op.upload!;
  const itemId = String(op.body.item_id ?? '');
  const parts: [string, string][] = [[u.sha256, u.mime_type]];
  if (u.thumb_sha256) parts.push([u.thumb_sha256, 'image/jpeg']);
  for (const [sha, mime] of parts) {
    const stored = await db.blobs.get(sha);
    if (!stored) throw new ApiError(422, 'MISSING_FILE', 'The photo file is no longer on this phone.');
    const r = await api<{ already_uploaded: boolean; signed_path?: string }>(
      `/estates/${op.estate_id}/items/${itemId}/photos/upload-url`,
      { method: 'POST', body: { sha256: sha, mime_type: mime } },
    );
    if (!r.already_uploaded && r.signed_path) await putSignedUpload(r.signed_path, stored.blob, mime);
  }
  await api(op.path, { method: op.method, body: op.body, idempotencyKey: op.id });
  await db.blobs.where('sha256').anyOf(parts.map((p) => p[0])).modify({ uploaded: true });
}

/** Send queued changes in order. Stops at the first network problem so order is kept. */
export async function flushOutbox(): Promise<FlushResult> {
  let sent = 0;
  const ops = await db.outbox.where('status').equals('pending').sortBy('seq');
  for (const op of ops) {
    try {
      if (op.kind === 'upload') await runUpload(op);
      else await api(op.path, { method: op.method, body: op.body, idempotencyKey: op.id });
      await db.outbox.delete(op.seq!);
      sent++;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
      if (err.retryable) {
        await db.outbox.update(op.seq!, { attempts: op.attempts + 1, last_error: err.message, error_code: err.code });
        return { sent, stoppedForNetwork: err.status !== 401, needsSignIn: err.status === 401 };
      }
      await db.outbox.update(op.seq!, {
        status: err.status === 409 ? 'conflict' : 'failed',
        attempts: op.attempts + 1,
        last_error: err.message,
        error_code: err.code,
        error_details: err.details,
      });
    }
  }
  return { sent, stoppedForNetwork: false, needsSignIn: false };
}

/** Try a failed change again (for example after fixing permissions). */
export async function retryOp(seq: number) {
  await db.outbox.update(seq, { status: 'pending', last_error: undefined, error_code: undefined, error_details: undefined });
  nudge();
}

/**
 * Re-apply an edit on top of someone else's newer version.
 * Only for item edits that hit a version conflict.
 */
export async function reapplyOnLatest(seq: number) {
  const op = await db.outbox.get(seq);
  const current = (op?.error_details as { current?: { version: number } } | undefined)?.current;
  if (!op || !current) return;
  const changes = (op.body.changes ?? {}) as Record<string, unknown>;
  await db.transaction('rw', db.outbox, db.items, async () => {
    // Show the newer version with this person's change on top while it uploads.
    await db.items.put({ ...current, ...changes, version: current.version + 1 } as never);
    await db.outbox.update(seq, {
      status: 'pending',
      id: crypto.randomUUID(),
      body: { ...op.body, version: current.version },
      last_error: undefined,
      error_details: undefined,
    });
  });
  nudge();
}

/**
 * Remove a change that the server refused. Allowed because it never became
 * part of the shared record. Locally created rows for it are removed too.
 */
export async function discardOp(seq: number) {
  const op = await db.outbox.get(seq);
  if (!op || op.status === 'pending') return;
  await db.transaction('rw', [db.outbox, db.items, db.locations, db.media, db.valuations, db.claims, db.custody_events], async () => {
    await db.outbox.delete(seq);
    if (op.path.endsWith('/items') && op.method === 'POST' && op.entity_id) await db.items.delete(op.entity_id);
    if (op.path.endsWith('/locations') && op.method === 'POST' && op.entity_id) await db.locations.delete(op.entity_id);
    if (op.kind === 'upload' && op.body.id) await db.media.delete(String(op.body.id));
    if (op.path.endsWith('/valuations') && op.body.id) await db.valuations.delete(String(op.body.id));
    if (op.path.endsWith('/claims') && op.body.id) await db.claims.delete(String(op.body.id));
    if (op.path.endsWith('/custody') && op.body.id) await db.custody_events.delete(String(op.body.id));
  });
}

export async function pendingFor(entityId: string): Promise<OutboxOp[]> {
  return db.outbox.where('entity_id').equals(entityId).toArray();
}

export { MEDIA_BUCKET };
