// The device's local copy of every estate the person belongs to, plus the
// queue of changes waiting to upload. Stored in IndexedDB, so it survives
// closing the app and works with no signal.
import Dexie, { type Table } from 'dexie';
import type {
  Claim, CustodyEvent, DecisionInvalidation, DuplicateReview, Estate, EstateData, GrabResolution, GrabRound, Invite,
  Item, Location, Media, MediaVerification, Member, NumberReservation, NumberVoid, Profile, Proposal,
  ProposalCancellation, ProposalCompletion, ProposalDecision, ProposalOutcomeRow, Redaction, Valuation,
} from '../../supabase/functions/_shared/domain.ts';

export type OutboxStatus = 'pending' | 'failed' | 'conflict';

export interface OutboxOp {
  seq?: number;
  /** Also the Idempotency-Key, so a replay after a dropped connection is harmless. */
  id: string;
  estate_id: string;
  created_at: string;
  kind: 'api' | 'upload';
  method: 'POST' | 'PUT' | 'PATCH';
  path: string;
  body: Record<string, unknown>;
  /** Record the change is about (item id, proposal id...), for "not yet uploaded" labels. */
  entity_id: string | null;
  /** Plain-language description shown in the upload queue. */
  label: string;
  status: OutboxStatus;
  attempts: number;
  last_error?: string;
  error_code?: string;
  error_details?: unknown;
  upload?: { sha256: string; thumb_sha256: string | null; mime_type: string };
}

export interface StoredBlob {
  sha256: string;
  estate_id: string;
  blob: Blob;
  mime_type: string;
  role: 'full' | 'thumb';
  /** True once the server has confirmed it (registered with a matching hash). */
  uploaded: boolean;
  created_at: string;
}

/** A capture that could not be numbered yet (no reserved numbers left while offline). */
export interface Draft {
  id: string;
  estate_id: string;
  created_at: string;
  payload: Record<string, unknown>;
  photos: { media_id: string; sha256: string; thumb_sha256: string; mime_type: string; byte_size: number; width: number; height: number; kind: string }[];
  duplicate_checks: unknown[];
}

export interface Witness {
  estate_id: string;
  seq: number;
  hash: string;
  seen_at: string;
}

export interface MyEstate extends Estate {
  my_role: Member['role'];
  my_permissions: Pick<Member, 'can_add_items' | 'can_edit_items' | 'can_propose' | 'can_approve' | 'can_export'>;
}

export interface Meta {
  key: string;
  value: unknown;
}

class EstateDB extends Dexie {
  estates!: Table<Estate, string>;
  myEstates!: Table<MyEstate, string>;
  members!: Table<Member, [string, string]>;
  profiles!: Table<Profile, string>;
  invites!: Table<Invite, string>;
  locations!: Table<Location, string>;
  items!: Table<Item, string>;
  media!: Table<Media, string>;
  valuations!: Table<Valuation, string>;
  proposals!: Table<Proposal, string>;
  proposal_decisions!: Table<ProposalDecision, string>;
  decision_invalidations!: Table<DecisionInvalidation, string>;
  proposal_outcomes!: Table<ProposalOutcomeRow, string>;
  proposal_completions!: Table<ProposalCompletion, string>;
  proposal_cancellations!: Table<ProposalCancellation, string>;
  custody_events!: Table<CustodyEvent, string>;
  grab_rounds!: Table<GrabRound, string>;
  grab_resolutions!: Table<GrabResolution, string>;
  claims!: Table<Claim, string>;
  redactions!: Table<Redaction, string>;
  duplicate_reviews!: Table<DuplicateReview, string>;
  number_reservations!: Table<NumberReservation, string>;
  number_voids!: Table<NumberVoid, [string, number]>;
  media_verifications!: Table<MediaVerification, number>;
  outbox!: Table<OutboxOp, number>;
  blobs!: Table<StoredBlob, string>;
  drafts!: Table<Draft, string>;
  witnesses!: Table<Witness, [string, number]>;
  meta!: Table<Meta, string>;

  constructor() {
    super('estate-inventory');
    this.version(1).stores({
      estates: 'id',
      myEstates: 'id',
      members: '[estate_id+user_id], estate_id, user_id',
      profiles: 'id',
      invites: 'id, estate_id',
      locations: 'id, estate_id, code, parent_id',
      items: 'id, estate_id, item_code, barcode, inventory_number, current_location_id',
      media: 'id, estate_id, item_id, sha256',
      valuations: 'id, estate_id, item_id',
      proposals: 'id, estate_id, item_id',
      proposal_decisions: 'id, estate_id, proposal_id',
      decision_invalidations: 'decision_id, estate_id',
      proposal_outcomes: 'proposal_id, estate_id',
      proposal_completions: 'proposal_id, estate_id',
      proposal_cancellations: 'proposal_id, estate_id',
      custody_events: 'id, estate_id, item_id',
      grab_rounds: 'id, estate_id, item_id',
      grab_resolutions: 'round_id, estate_id',
      claims: 'id, estate_id, round_id',
      redactions: 'id, estate_id, media_id',
      duplicate_reviews: 'id, estate_id',
      number_reservations: 'id, estate_id, user_id',
      number_voids: '[estate_id+inventory_number], estate_id',
      media_verifications: 'id, estate_id',
      outbox: '++seq, id, estate_id, status, entity_id',
      blobs: 'sha256, estate_id, uploaded',
      drafts: 'id, estate_id',
      witnesses: '[estate_id+seq], estate_id',
      meta: 'key',
    });
  }
}

export const db = new EstateDB();

/** Server table name -> local table. Keys match the arrays returned by /sync. */
export const SYNC_TABLES = {
  members: 'members',
  profiles: 'profiles',
  invites: 'invites',
  locations: 'locations',
  items: 'items',
  media: 'media',
  valuations: 'valuations',
  proposals: 'proposals',
  proposal_decisions: 'proposal_decisions',
  decision_invalidations: 'decision_invalidations',
  proposal_outcomes: 'proposal_outcomes',
  proposal_completions: 'proposal_completions',
  proposal_cancellations: 'proposal_cancellations',
  custody_events: 'custody_events',
  grab_rounds: 'grab_rounds',
  grab_resolutions: 'grab_resolutions',
  claims: 'claims',
  redactions: 'redactions',
  duplicate_reviews: 'duplicate_reviews',
  number_reservations: 'number_reservations',
  number_voids: 'number_voids',
  media_verifications: 'media_verifications',
} as const;

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return (row?.value as T) ?? fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** A stable random id for this device (used for number reservations). */
export async function deviceId(): Promise<string> {
  let id = await getMeta<string | null>('device_id', null);
  if (!id) {
    id = `dev-${crypto.randomUUID().slice(0, 13)}`;
    await setMeta('device_id', id);
  }
  return id;
}

/** Load everything held locally for one estate. */
export async function loadEstateData(estateId: string): Promise<EstateData> {
  const by = <T>(t: Table<T, any>) => t.where('estate_id').equals(estateId).toArray();
  const [
    estate, members, invites, locations, items, media, valuations, proposals, proposal_decisions,
    decision_invalidations, proposal_outcomes, proposal_completions, proposal_cancellations, custody_events,
    grab_rounds, grab_resolutions, claims, redactions, duplicate_reviews, number_reservations, number_voids,
    media_verifications,
  ] = await Promise.all([
    db.estates.get(estateId), by(db.members), by(db.invites), by(db.locations), by(db.items), by(db.media),
    by(db.valuations), by(db.proposals), by(db.proposal_decisions), by(db.decision_invalidations),
    by(db.proposal_outcomes), by(db.proposal_completions), by(db.proposal_cancellations), by(db.custody_events),
    by(db.grab_rounds), by(db.grab_resolutions), by(db.claims), by(db.redactions), by(db.duplicate_reviews),
    by(db.number_reservations), by(db.number_voids), by(db.media_verifications),
  ]);
  const profiles = await db.profiles.bulkGet(members.map((m) => m.user_id));
  return {
    estate: estate ?? null,
    members, invites, locations, items, media, valuations, proposals, proposal_decisions, decision_invalidations,
    proposal_outcomes, proposal_completions, proposal_cancellations, custody_events, grab_rounds,
    grab_resolutions, claims, redactions, duplicate_reviews, number_reservations, number_voids, media_verifications,
    profiles: profiles.filter(Boolean) as Profile[],
  };
}

/** Ask the browser not to evict this app's data. Granted most reliably for installed (Home Screen) apps. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
