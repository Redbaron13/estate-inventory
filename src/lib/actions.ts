// Everything a person can do. Each action updates the phone's copy right away
// (so it shows up offline) and queues the change for upload. The server
// remains the authority: after the next sync, its version replaces the local one.
import { deriveLocationTag, makeItemCode, makeLocationCode, type LocationKind } from '../../supabase/functions/_shared/codes.ts';
import {
  byId, foundTag,
  type Claim, type CustodyEventType, type DuplicateReason, type DuplicateVerdict, type GrabRound, type Interest, type Item,
  type ItemStatus, type Location, type Media, type MediaKind, type Proposal, type ProposalAction, type Decision,
  type ResolutionMethod, type Valuation, type ValuationType,
} from '../../supabase/functions/_shared/domain.ts';
import { api } from './api';
import { db, deviceId, type Draft } from './db';
import type { PreparedPhoto } from './images';
import { newOp, nudge } from './outbox';
import { supabase } from './supabase';

const now = () => new Date().toISOString();

export async function myUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function requireUser(): Promise<string> {
  const id = await myUserId();
  if (!id) throw new Error('Please sign in.');
  return id;
}

// ---------------------------------------------------------------------------
// Inventory numbers held by this device
// ---------------------------------------------------------------------------
async function availableNumbersFor(estateId: string, userId: string, device: string): Promise<number[]> {
  const [reservations, items, voids] = await Promise.all([
    db.number_reservations.where('estate_id').equals(estateId).toArray(),
    db.items.where('estate_id').equals(estateId).toArray(),
    db.number_voids.where('estate_id').equals(estateId).toArray(),
  ]);
  const used = new Set(items.map((i) => i.inventory_number));
  const voided = new Set(voids.map((v) => v.inventory_number));
  const out: number[] = [];
  for (const r of reservations.filter((r) => r.user_id === userId && r.device_id === device)) {
    for (let n = r.first_number; n <= r.last_number; n++) if (!used.has(n) && !voided.has(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

export async function availableNumbers(estateId: string): Promise<number[]> {
  const me = await myUserId();
  if (!me) return [];
  return availableNumbersFor(estateId, me, await deviceId());
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------
export type NextStep =
  | { type: 'review' }
  | { type: 'grab' }
  | { type: 'appraisal' }
  | { type: 'proposal'; action: ProposalAction; recipient_user_id?: string | null; organization?: string | null; reason?: string | null };

export interface CapturePhoto extends PreparedPhoto {
  kind: MediaKind;
}

export interface CaptureInput {
  estateId: string;
  title: string;
  category: string;
  quantity: number;
  foundLocationId: string | null;
  locationId: string | null;
  status?: ItemStatus;
  description?: string | null;
  condition?: string | null;
  barcode?: string | null;
  barcode_format?: string | null;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  markings?: string | null;
  notes?: string | null;
  potentially_valuable?: boolean;
  do_not_move?: boolean;
  do_not_move_reason?: string | null;
  photos: CapturePhoto[];
  duplicateChecks: { other_item_id: string; verdict: Extract<DuplicateVerdict, 'DIFFERENT_ITEMS' | 'UNSURE'>; reasons: DuplicateReason[] }[];
  nextStep: NextStep;
}

export type CaptureResult = { kind: 'item'; item: Item } | { kind: 'draft'; draftId: string };

// Every table an item capture can write, including a new up-for-grabs round.
const ITEM_TABLES = [db.items, db.number_reservations, db.number_voids, db.members, db.locations, db.estates, db.outbox, db.blobs, db.media, db.drafts, db.meta, db.grab_rounds];

function storePhotoBlobs(estateId: string, p: PreparedPhoto) {
  return Promise.all([
    db.blobs.put({ sha256: p.sha256, estate_id: estateId, blob: p.full, mime_type: p.mime_type, role: 'full', uploaded: false, created_at: now() }),
    db.blobs.put({ sha256: p.thumb_sha256, estate_id: estateId, blob: p.thumb, mime_type: 'image/jpeg', role: 'thumb', uploaded: false, created_at: now() }),
  ]);
}

function photoOps(estateId: string, itemId: string, userId: string, photos: { media_id: string; sha256: string; thumb_sha256: string; mime_type: string; byte_size: number; width: number; height: number; kind: string }[], label: string) {
  return photos.map((p, i) => {
    const media: Media = {
      id: p.media_id, estate_id: estateId, item_id: itemId, kind: p.kind as MediaKind, sha256: p.sha256,
      storage_path: `${estateId}/${p.sha256}.jpg`, thumb_sha256: p.thumb_sha256, thumb_path: `${estateId}/${p.thumb_sha256}.jpg`,
      mime_type: p.mime_type, byte_size: p.byte_size, width: p.width, height: p.height, caption: null,
      captured_at: now(), uploaded_by: userId, created_at: now(),
    };
    const op = newOp({
      estate_id: estateId, kind: 'upload', method: 'POST', path: `/estates/${estateId}/items/${itemId}/photos`,
      body: {
        id: p.media_id, item_id: itemId, sha256: p.sha256, thumb_sha256: p.thumb_sha256, mime_type: p.mime_type,
        byte_size: p.byte_size, width: p.width, height: p.height, kind: p.kind, captured_at: media.captured_at,
      },
      entity_id: itemId, label: `Photo ${i + 1} for ${label}`,
      upload: { sha256: p.sha256, thumb_sha256: p.thumb_sha256, mime_type: p.mime_type },
    });
    return { media, op };
  });
}

function nextStepOps(estateId: string, item: Item, step: NextStep, estateClaimMode: string | undefined, sealedHours: number) {
  const ops = [];
  let status = item.status;
  let round: GrabRound | null = null;
  if (step.type === 'grab') {
    const id = crypto.randomUUID();
    round = {
      id, estate_id: estateId, item_id: item.id, mode: (estateClaimMode as 'SEALED' | 'OPEN') ?? 'SEALED',
      reveal_at: estateClaimMode === 'OPEN' ? null : new Date(Date.now() + sealedHours * 3600_000).toISOString(),
      note: null, opened_by: item.created_by, created_at: now(),
    };
    ops.push(newOp({ estate_id: estateId, kind: 'api', method: 'POST', path: `/estates/${estateId}/items/${item.id}/grab-rounds`, body: { id }, entity_id: item.id, label: `Put #${item.inventory_number} up for grabs` }));
    status = 'UP_FOR_GRABS';
  } else if (step.type === 'proposal') {
    ops.push(newOp({
      estate_id: estateId, kind: 'api', method: 'POST', path: `/estates/${estateId}/items/${item.id}/proposals`,
      body: { id: crypto.randomUUID(), action: step.action, recipient_user_id: step.recipient_user_id ?? null, organization: step.organization ?? null, reason: step.reason ?? null },
      entity_id: item.id, label: `Propose: ${step.action.toLowerCase()} #${item.inventory_number}`,
    }));
    status = 'APPROVAL_PENDING';
  }
  return { ops, status, round };
}

/**
 * Save a new item. Works offline: the item gets a permanent number from this
 * phone's reserved block. If the block is used up while offline, the capture
 * is kept as a draft and numbered at the next sync. Nothing is discarded.
 */
export async function captureItem(input: CaptureInput): Promise<CaptureResult> {
  const me = await requireUser();
  const device = await deviceId();
  const photos = input.photos.map((p) => ({
    media_id: crypto.randomUUID(), sha256: p.sha256, thumb_sha256: p.thumb_sha256, mime_type: p.mime_type,
    byte_size: p.byte_size, width: p.width, height: p.height, kind: p.kind,
  }));
  const result = await db.transaction('rw', ITEM_TABLES, async () => {
    for (const p of input.photos) await storePhotoBlobs(input.estateId, p);
    const numbers = await availableNumbersFor(input.estateId, me, device);
    const member = await db.members.get([input.estateId, me]);
    if (!numbers.length || !member?.member_code) {
      const draft: Draft = {
        id: crypto.randomUUID(), estate_id: input.estateId, created_at: now(),
        payload: { ...input, photos: undefined, duplicateChecks: undefined },
        photos, duplicate_checks: input.duplicateChecks,
      };
      await db.drafts.add(draft);
      return { kind: 'draft', draftId: draft.id } as CaptureResult;
    }
    const item = await materialize(input, numbers[0], member.member_code, me, device, photos);
    return { kind: 'item', item } as CaptureResult;
  });
  nudge();
  return result;
}

async function materialize(
  input: Omit<CaptureInput, 'photos'>,
  inventoryNumber: number,
  memberCode: string,
  me: string,
  device: string,
  photos: Draft['photos'],
): Promise<Item> {
  const locations = byId(await db.locations.where('estate_id').equals(input.estateId).toArray());
  const estate = await db.estates.get(input.estateId);
  const placeId = input.locationId ?? input.foundLocationId ?? estate?.default_location_id ?? null;
  const item: Item = {
    id: crypto.randomUUID(), estate_id: input.estateId, inventory_number: inventoryNumber,
    item_code: makeItemCode({ inventoryNumber, memberCode, foundTag: foundTag(input.foundLocationId, locations), category: input.category }),
    title: input.title.trim(), description: input.description ?? null, category: input.category, quantity: input.quantity || 1,
    condition: input.condition ?? null, barcode: input.barcode ?? null, barcode_format: input.barcode_format ?? null,
    brand: input.brand ?? null, model: input.model ?? null, serial_number: input.serial_number ?? null, dimensions: null,
    weight: null, markings: input.markings ?? null, provenance: null, notes: input.notes ?? null,
    original_location_id: input.foundLocationId, current_location_id: placeId,
    status: input.nextStep.type === 'appraisal' ? 'NEEDS_VALUATION' : input.status ?? 'DISCOVERED',
    potentially_valuable: input.nextStep.type === 'appraisal' ? true : !!input.potentially_valuable,
    do_not_move: !!input.do_not_move, do_not_move_reason: input.do_not_move_reason ?? null,
    physically_verified_at: null, physically_verified_by: null, merged_into_id: null, device_id: device,
    captured_at: now(), created_by: me, created_at: now(), updated_by: me, updated_at: now(), version: 1,
  };
  const label = `#${item.inventory_number} ${item.title}`;
  const create = newOp({
    estate_id: input.estateId, kind: 'api', method: 'POST', path: `/estates/${input.estateId}/items`,
    body: {
      id: item.id, inventory_number: item.inventory_number, item_code: item.item_code, title: item.title,
      category: item.category, quantity: item.quantity, found_location_id: input.foundLocationId, location_id: placeId,
      status: item.status, description: item.description, condition: item.condition, barcode: item.barcode,
      barcode_format: item.barcode_format, brand: item.brand, model: item.model, serial_number: item.serial_number,
      markings: item.markings, notes: item.notes, potentially_valuable: item.potentially_valuable, do_not_move: item.do_not_move,
      do_not_move_reason: item.do_not_move_reason, device_id: device, captured_at: item.captured_at,
      duplicate_checks: input.duplicateChecks,
    },
    entity_id: item.id, label: `Add ${label}`,
  });
  const next = nextStepOps(input.estateId, item, input.nextStep, estate?.claim_mode, estate?.sealed_window_hours ?? 72);
  item.status = next.status;
  await db.items.add(item);
  await db.outbox.add(create);
  for (const { media, op } of photoOps(input.estateId, item.id, me, photos, label)) {
    await db.media.put(media);
    await db.outbox.add(op);
  }
  if (next.round) await db.grab_rounds.put(next.round);
  for (const op of next.ops) await db.outbox.add(op);
  return item;
}

/** Number and queue captures that were saved while no numbers were available. */
export async function convertDrafts(estateId: string): Promise<number> {
  const me = await myUserId();
  if (!me) return 0;
  const device = await deviceId();
  const drafts = await db.drafts.where('estate_id').equals(estateId).sortBy('created_at');
  let converted = 0;
  for (const d of drafts) {
    const ok = await db.transaction('rw', ITEM_TABLES, async () => {
      const numbers = await availableNumbersFor(estateId, me, device);
      const member = await db.members.get([estateId, me]);
      if (!numbers.length || !member?.member_code) return false;
      const input = { ...(d.payload as unknown as Omit<CaptureInput, 'photos'>), duplicateChecks: d.duplicate_checks as CaptureInput['duplicateChecks'] };
      await materialize(input, numbers[0], member.member_code, me, device, d.photos);
      await db.drafts.delete(d.id);
      return true;
    });
    if (!ok) break;
    converted++;
  }
  if (converted) nudge();
  return converted;
}

// ---------------------------------------------------------------------------
// Item edits and photos
// ---------------------------------------------------------------------------
export async function updateItem(item: Item, changes: Partial<Item> & { mark_verified?: boolean }) {
  const me = await requireUser();
  const { mark_verified, ...fields } = changes;
  const base: Record<string, unknown> = {};
  for (const k of Object.keys(changes)) if (k !== 'mark_verified') base[k] = (item as unknown as Record<string, unknown>)[k] ?? null;
  const local: Item = {
    ...item, ...fields, version: item.version + 1, updated_at: now(), updated_by: me,
    ...(mark_verified ? { physically_verified_at: now(), physically_verified_by: me } : {}),
  };
  await db.transaction('rw', db.items, db.outbox, async () => {
    await db.items.put(local);
    await db.outbox.add(newOp({
      estate_id: item.estate_id, kind: 'api', method: 'PATCH', path: `/estates/${item.estate_id}/items/${item.id}`,
      body: { version: item.version, changes, base }, entity_id: item.id,
      label: mark_verified && Object.keys(fields).length === 0 ? `Confirm #${item.inventory_number} is in place` : `Edit #${item.inventory_number} ${item.title}`,
    }));
  });
  nudge();
}

export async function addPhotos(item: Item, photos: CapturePhoto[]) {
  const me = await requireUser();
  const rows = photos.map((p) => ({ media_id: crypto.randomUUID(), sha256: p.sha256, thumb_sha256: p.thumb_sha256, mime_type: p.mime_type, byte_size: p.byte_size, width: p.width, height: p.height, kind: p.kind }));
  await db.transaction('rw', db.blobs, db.media, db.outbox, async () => {
    for (const p of photos) await storePhotoBlobs(item.estate_id, p);
    for (const { media, op } of photoOps(item.estate_id, item.id, me, rows, `#${item.inventory_number} ${item.title}`)) {
      await db.media.put(media);
      await db.outbox.add(op);
    }
  });
  nudge();
  return rows.map((r) => r.media_id);
}

export async function redactMedia(media: Media, reason: string) {
  const me = await requireUser();
  const id = crypto.randomUUID();
  await db.transaction('rw', db.redactions, db.outbox, async () => {
    await db.redactions.put({ id, estate_id: media.estate_id, media_id: media.id, reason, redacted_by: me, created_at: now() });
    await db.outbox.add(newOp({ id, estate_id: media.estate_id, kind: 'api', method: 'POST', path: `/estates/${media.estate_id}/media/${media.id}/redact`, body: { reason }, entity_id: media.item_id, label: 'Hide a photo' }));
  });
  nudge();
}

export async function addValuation(item: Item, v: { valuation_type: ValuationType; amount: number; valuation_date?: string; source?: string | null; appraiser_name?: string | null; comparable_url?: string | null; notes?: string | null; supersedes_id?: string | null }) {
  const me = await requireUser();
  const row: Valuation = {
    id: crypto.randomUUID(), estate_id: item.estate_id, item_id: item.id, valuation_type: v.valuation_type, amount: v.amount,
    currency: 'USD', valuation_date: v.valuation_date ?? now().slice(0, 10), source: v.source ?? null,
    appraiser_name: v.appraiser_name ?? null, comparable_url: v.comparable_url ?? null, notes: v.notes ?? null,
    attachment_media_id: null, supersedes_id: v.supersedes_id ?? null, entered_by: me, created_at: now(),
  };
  await db.transaction('rw', db.valuations, db.outbox, async () => {
    await db.valuations.put(row);
    await db.outbox.add(newOp({ estate_id: item.estate_id, kind: 'api', method: 'POST', path: `/estates/${item.estate_id}/items/${item.id}/valuations`, body: { ...row }, entity_id: item.id, label: `Value for #${item.inventory_number}` }));
  });
  nudge();
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------
export async function createLocation(estateId: string, input: { name: string; kind: LocationKind; parentId: string | null; purpose?: string | null; tag?: string | null }): Promise<Location> {
  const me = await requireUser();
  const existing = await db.locations.where('estate_id').equals(estateId).toArray();
  const loc: Location = {
    id: crypto.randomUUID(), estate_id: estateId, parent_id: input.parentId, name: input.name.trim(), kind: input.kind,
    code: makeLocationCode(input.kind), tag: (input.tag || deriveLocationTag(input.name, existing.filter((l) => !l.archived_at).map((l) => l.tag))).toUpperCase(),
    purpose: input.purpose ?? null, person_id: null, created_by: me, created_at: now(), archived_at: null, updated_at: now(),
  };
  await db.transaction('rw', db.locations, db.outbox, async () => {
    await db.locations.add(loc);
    await db.outbox.add(newOp({
      estate_id: estateId, kind: 'api', method: 'POST', path: `/estates/${estateId}/locations`,
      body: { id: loc.id, parent_id: loc.parent_id, name: loc.name, kind: loc.kind, code: loc.code, tag: loc.tag, purpose: loc.purpose },
      entity_id: loc.id, label: `Add place "${loc.name}"`,
    }));
  });
  nudge();
  return loc;
}

export async function updateLocation(loc: Location, changes: { name?: string; parent_id?: string | null; purpose?: string | null; tag?: string; archived?: boolean }) {
  const { archived, ...rest } = changes;
  await db.transaction('rw', db.locations, db.outbox, async () => {
    await db.locations.put({ ...loc, ...rest, archived_at: archived === undefined ? loc.archived_at : archived ? now() : null, updated_at: now() });
    await db.outbox.add(newOp({ estate_id: loc.estate_id, kind: 'api', method: 'PATCH', path: `/estates/${loc.estate_id}/locations/${loc.id}`, body: changes, entity_id: loc.id, label: `Update place "${loc.name}"` }));
  });
  nudge();
}

// ---------------------------------------------------------------------------
// Custody: moves, put-away, handoffs, missing/found
// ---------------------------------------------------------------------------
export interface CustodyInput {
  event_type: Extract<CustodyEventType, 'MOVED' | 'HANDOFF' | 'RETURNED' | 'FOUND' | 'REPORTED_MISSING'>;
  to_location_id?: string | null;
  received_by_user_id?: string | null;
  received_by_name?: string | null;
  purpose?: string | null;
  notes?: string | null;
  occurred_at?: string;
  photo_media_id?: string | null;
  receipt_media_id?: string | null;
}

export async function recordCustody(item: Item, input: CustodyInput) {
  const me = await requireUser();
  const id = crypto.randomUUID();
  const occurred = input.occurred_at ?? now();
  await db.transaction('rw', db.items, db.custody_events, db.outbox, async () => {
    await db.custody_events.put({
      id, estate_id: item.estate_id, item_id: item.id, event_type: input.event_type, from_location_id: item.current_location_id,
      to_location_id: input.to_location_id ?? null, released_by_user_id: null, received_by_user_id: input.received_by_user_id ?? null,
      received_by_name: input.received_by_name ?? null, purpose: input.purpose ?? null, occurred_at: occurred, notes: input.notes ?? null,
      receipt_media_id: input.receipt_media_id ?? null, photo_media_id: input.photo_media_id ?? null, proposal_id: null, recorded_by: me, created_at: now(),
    });
    await db.items.put({
      ...item,
      current_location_id: input.to_location_id ?? item.current_location_id,
      status: input.event_type === 'REPORTED_MISSING' ? 'MISSING' : item.status,
      updated_at: now(),
    });
    await db.outbox.add(newOp({
      estate_id: item.estate_id, kind: 'api', method: 'POST', path: `/estates/${item.estate_id}/items/${item.id}/custody`,
      body: { id, ...input, occurred_at: occurred }, entity_id: item.id,
      label: `${input.event_type === 'MOVED' ? 'Move' : input.event_type.toLowerCase().replace('_', ' ')} #${item.inventory_number}`,
    }));
  });
  nudge();
}

// ---------------------------------------------------------------------------
// Up for grabs
// ---------------------------------------------------------------------------
export async function openRound(item: Item, note?: string) {
  const estate = await db.estates.get(item.estate_id);
  const step = nextStepOps(item.estate_id, item, { type: 'grab' }, estate?.claim_mode, estate?.sealed_window_hours ?? 72);
  if (note) step.ops[0].body.note = note;
  await db.transaction('rw', db.items, db.grab_rounds, db.outbox, async () => {
    if (step.round) await db.grab_rounds.put({ ...step.round, note: note ?? null });
    await db.items.put({ ...item, status: 'UP_FOR_GRABS' });
    for (const op of step.ops) await db.outbox.add(op);
  });
  nudge();
}

export async function setClaim(item: Item, interest: Interest, note?: string | null, roundId?: string) {
  const me = await requireUser();
  const id = crypto.randomUUID();
  await db.transaction('rw', db.claims, db.outbox, async () => {
    if (roundId) {
      const claim: Claim = { id, estate_id: item.estate_id, round_id: roundId, item_id: item.id, user_id: me, interest, note: note ?? null, created_at: now() };
      await db.claims.put(claim);
    }
    await db.outbox.add(newOp({
      estate_id: item.estate_id, kind: 'api', method: 'PUT', path: `/estates/${item.estate_id}/items/${item.id}/claims`,
      body: { id, interest, note: note ?? null }, entity_id: item.id, label: `Your choice on #${item.inventory_number}`,
    }));
  });
  nudge();
}

export async function resolveRound(item: Item, roundId: string, method: ResolutionMethod, opts: { winner_user_id?: string | null; reason?: string | null; amount?: number | null } = {}) {
  await db.outbox.add(newOp({
    estate_id: item.estate_id, kind: 'api', method: 'POST', path: `/estates/${item.estate_id}/grab-rounds/${roundId}/resolve`,
    body: { method, ...opts }, entity_id: item.id, label: `Settle up-for-grabs on #${item.inventory_number}`,
  }));
  nudge();
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------
export async function createProposal(item: Item, p: { action: ProposalAction; recipient_user_id?: string | null; recipient_name?: string | null; organization?: string | null; amount?: number | null; reason?: string | null }) {
  await db.transaction('rw', db.items, db.outbox, async () => {
    await db.items.put({ ...item, status: 'APPROVAL_PENDING' });
    await db.outbox.add(newOp({
      estate_id: item.estate_id, kind: 'api', method: 'POST', path: `/estates/${item.estate_id}/items/${item.id}/proposals`,
      body: { id: crypto.randomUUID(), ...p }, entity_id: item.id, label: `Propose: ${p.action.toLowerCase()} #${item.inventory_number}`,
    }));
  });
  nudge();
}

export async function decide(proposal: Proposal, decision: Decision, comment?: string | null) {
  const me = await requireUser();
  const id = crypto.randomUUID();
  await db.transaction('rw', db.proposal_decisions, db.outbox, async () => {
    await db.proposal_decisions.put({ id, estate_id: proposal.estate_id, proposal_id: proposal.id, user_id: me, decision, comment: comment ?? null, created_at: now() });
    await db.outbox.add(newOp({
      id, estate_id: proposal.estate_id, kind: 'api', method: 'PUT', path: `/estates/${proposal.estate_id}/proposals/${proposal.id}/decision`,
      body: { decision, comment: comment ?? null }, entity_id: proposal.item_id, label: `Your ${decision.toLowerCase()} on a decision`,
    }));
  });
  nudge();
}

export async function withdrawProposal(proposal: Proposal, reason: string) {
  await db.outbox.add(newOp({ estate_id: proposal.estate_id, kind: 'api', method: 'POST', path: `/estates/${proposal.estate_id}/proposals/${proposal.id}/withdraw`, body: { reason }, entity_id: proposal.item_id, label: 'Withdraw a decision' }));
  nudge();
}

export async function invalidateDecision(estateId: string, decisionId: string, itemId: string, reason: string) {
  await db.outbox.add(newOp({ estate_id: estateId, kind: 'api', method: 'POST', path: `/estates/${estateId}/decisions/${decisionId}/invalidate`, body: { reason }, entity_id: itemId, label: 'Set aside a decision' }));
  nudge();
}

export async function completeProposal(proposal: Proposal, input: { occurred_at?: string; received_by_name?: string | null; notes?: string | null; final_amount?: number | null; to_location_id?: string | null; receipt?: CapturePhoto | null }) {
  const item = await db.items.get(proposal.item_id);
  if (!item) throw new Error('Item not found on this phone.');
  let receiptId: string | null = null;
  if (input.receipt) [receiptId] = await addPhotos(item, [input.receipt]);
  await db.outbox.add(newOp({
    estate_id: proposal.estate_id, kind: 'api', method: 'POST', path: `/estates/${proposal.estate_id}/proposals/${proposal.id}/complete`,
    body: {
      custody_event_id: crypto.randomUUID(), occurred_at: input.occurred_at ?? now(), received_by_name: input.received_by_name ?? null,
      notes: input.notes ?? null, final_amount: input.final_amount ?? null, to_location_id: input.to_location_id ?? null,
      receipt_media_id: receiptId,
    },
    entity_id: proposal.item_id, label: `Record completion for #${item.inventory_number}`,
  }));
  nudge();
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------
export async function reviewDuplicate(item: Item, other: Item, verdict: DuplicateVerdict, reasons: DuplicateReason[], note?: string) {
  const me = await requireUser();
  const id = crypto.randomUUID();
  await db.transaction('rw', db.items, db.duplicate_reviews, db.outbox, async () => {
    await db.duplicate_reviews.put({ id, estate_id: item.estate_id, item_id: item.id, other_item_id: other.id, verdict, reasons, note: note ?? null, decided_by: me, created_at: now() });
    if (verdict === 'SAME_ITEM') await db.items.put({ ...item, status: 'MERGED', merged_into_id: other.id });
    await db.outbox.add(newOp({
      estate_id: item.estate_id, kind: 'api', method: 'POST', path: `/estates/${item.estate_id}/duplicates/review`,
      body: { id, item_id: item.id, other_item_id: other.id, verdict, reasons, note: note ?? null }, entity_id: item.id,
      label: verdict === 'SAME_ITEM' ? `Merge #${item.inventory_number} into #${other.inventory_number}` : `Duplicate check on #${item.inventory_number}`,
      rollback: verdict === 'SAME_ITEM' ? { item: { status: item.status, merged_into_id: item.merged_into_id } } : undefined,
    }));
  });
  nudge();
}

// ---------------------------------------------------------------------------
// Online-only (administration). These need a connection because the result
// (a new estate, an invitation code) must come from the server.
// ---------------------------------------------------------------------------
export const online = {
  createEstate: (body: Record<string, unknown>) => api('/estates', { method: 'POST', body, idempotencyKey: crypto.randomUUID() }),
  updateEstate: (estateId: string, version: number, changes: Record<string, unknown>) =>
    api(`/estates/${estateId}`, { method: 'PATCH', body: { version, changes }, idempotencyKey: crypto.randomUUID() }),
  createInvite: (estateId: string, email: string, role: string) =>
    api<{ invite: { id: string }; code: string }>(`/estates/${estateId}/invites`, { method: 'POST', body: { email, role }, idempotencyKey: crypto.randomUUID() }),
  revokeInvite: (estateId: string, inviteId: string) => api(`/estates/${estateId}/invites/${inviteId}/revoke`, { method: 'POST', body: {} }),
  acceptInvite: (code: string) => api('/invites/accept', { method: 'POST', body: { code }, idempotencyKey: crypto.randomUUID() }),
  updateMember: (estateId: string, userId: string, changes: Record<string, unknown>) =>
    api(`/estates/${estateId}/members/${userId}`, { method: 'PATCH', body: { changes }, idempotencyKey: crypto.randomUUID() }),
  removeMember: (estateId: string, userId: string, reason: string) =>
    api(`/estates/${estateId}/members/${userId}/remove`, { method: 'POST', body: { reason }, idempotencyKey: crypto.randomUUID() }),
  updateProfile: (body: Record<string, unknown>) => api('/me', { method: 'PATCH', body, idempotencyKey: crypto.randomUUID() }),
  barcodeLookup: (value: string) => api<{ found: boolean; title?: string; brand?: string; model?: string }>(`/barcode/${encodeURIComponent(value)}`),
};
