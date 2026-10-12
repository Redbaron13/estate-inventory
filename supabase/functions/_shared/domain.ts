// Shared domain model: row types (as returned by the database), plain-language
// labels, and derived state. Pure TypeScript, used by the web app (offline,
// over its local copy) and by the API.

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------
export type MemberRole = 'ADMINISTRATOR' | 'EXECUTOR' | 'BENEFICIARY' | 'FAMILY_MEMBER' | 'APPRAISER' | 'VIEW_ONLY';
export type ItemStatus =
  | 'DISCOVERED' | 'NEEDS_IDENTIFICATION' | 'NEEDS_VALUATION' | 'NEEDS_DECISION'
  | 'UP_FOR_GRABS' | 'CLAIM_REQUESTED' | 'ASSIGNED' | 'APPROVAL_PENDING'
  | 'APPROVED_FOR_SALE' | 'APPROVED_FOR_DONATION' | 'APPROVED_FOR_DISPOSAL'
  | 'SOLD' | 'DONATED' | 'DISTRIBUTED' | 'DISPOSED' | 'MISSING' | 'ON_HOLD' | 'MERGED';
export type ApprovalRule = 'EXECUTOR' | 'UNANIMOUS' | 'MAJORITY';
export type ClaimMode = 'SEALED' | 'OPEN';
export type LocationKind = 'PROPERTY' | 'AREA' | 'CONTAINER' | 'STAGING' | 'HOLDING' | 'PERSON' | 'EXTERNAL';
export type MediaKind = 'FULL_ITEM' | 'MARK' | 'SERIAL' | 'DAMAGE' | 'PACKAGING' | 'RECEIPT' | 'DOCUMENT' | 'HANDOFF' | 'BARCODE' | 'OTHER';
export type ValuationType =
  | 'FAMILY_ESTIMATE' | 'THIRD_PARTY_ESTIMATE' | 'FORMAL_APPRAISAL' | 'DATE_OF_DEATH'
  | 'INSURANCE' | 'LISTING_PRICE' | 'SALE_PROCEEDS' | 'DONATION_VALUE';
export type Interest = 'INTERESTED' | 'NOT_INTERESTED' | 'NEED_INFO';
export type ResolutionMethod =
  | 'SOLE_INTEREST' | 'DISCUSSION' | 'RANDOM_DRAW' | 'ROTATION' | 'INHERITANCE_CREDIT'
  | 'PURCHASE' | 'NO_INTEREST' | 'CANCELLED';
export type ProposalAction = 'ASSIGN' | 'SELL' | 'DONATE' | 'RECYCLE' | 'DISPOSE';
export type Decision = 'APPROVE' | 'REJECT' | 'ABSTAIN';
export type ProposalOutcome = 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export type CustodyEventType =
  | 'MOVED' | 'HANDOFF' | 'SOLD' | 'DONATED' | 'DISPOSED' | 'RETURNED' | 'FOUND' | 'REPORTED_MISSING';
export type DuplicateVerdict = 'SAME_ITEM' | 'DIFFERENT_ITEMS' | 'UNSURE';
export type DuplicateReason = 'BARCODE' | 'SERIAL' | 'PHOTO' | 'NAME';

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export interface Estate {
  id: string; name: string; decedent_name: string | null; date_of_death: string | null;
  case_reference: string | null; approval_rule: ApprovalRule; auto_approve_below: number | null;
  unanimous_above: number | null; claim_mode: ClaimMode; sealed_window_hours: number;
  help_contact_name: string | null; help_contact_phone: string | null; retention_years: number;
  next_inventory_number: number; default_location_id: string | null; created_by: string;
  created_at: string; updated_at: string; version: number;
}
export interface Member {
  estate_id: string; user_id: string; role: MemberRole; member_code: string | null;
  can_add_items: boolean; can_edit_items: boolean; can_propose: boolean; can_approve: boolean; can_export: boolean;
  is_active: boolean; invited_by: string | null; joined_at: string; removed_at: string | null;
  removed_by: string | null; removal_reason: string | null; updated_at: string;
}
export interface Profile { id: string; display_name: string; email: string | null; phone: string | null }
export interface Invite {
  id: string; estate_id: string; email: string; role: MemberRole; invited_by: string; created_at: string;
  expires_at: string; accepted_at: string | null; accepted_by: string | null; revoked_at: string | null;
}
export interface Location {
  id: string; estate_id: string; parent_id: string | null; name: string; kind: LocationKind; code: string;
  tag: string; purpose: string | null; person_id: string | null; created_by: string; created_at: string;
  archived_at: string | null; updated_at: string;
}
export interface Item {
  id: string; estate_id: string; inventory_number: number; item_code: string; title: string;
  description: string | null; category: string; quantity: number; condition: string | null;
  barcode: string | null; barcode_format: string | null; brand: string | null; model: string | null;
  serial_number: string | null; dimensions: string | null; weight: string | null; markings: string | null;
  provenance: string | null; notes: string | null; original_location_id: string | null;
  current_location_id: string | null; status: ItemStatus; potentially_valuable: boolean; do_not_move: boolean;
  do_not_move_reason: string | null; physically_verified_at: string | null; physically_verified_by: string | null;
  merged_into_id: string | null; device_id: string | null; captured_at: string | null; created_by: string;
  created_at: string; updated_by: string | null; updated_at: string; version: number;
}
export interface Media {
  id: string; estate_id: string; item_id: string | null; kind: MediaKind; sha256: string; storage_path: string;
  thumb_sha256: string | null; thumb_path: string | null; mime_type: string; byte_size: number;
  width: number | null; height: number | null; caption: string | null; captured_at: string | null;
  uploaded_by: string; created_at: string;
}
export interface Valuation {
  id: string; estate_id: string; item_id: string; valuation_type: ValuationType; amount: number | string;
  currency: string; valuation_date: string; source: string | null; appraiser_name: string | null;
  comparable_url: string | null; notes: string | null; attachment_media_id: string | null;
  supersedes_id: string | null; entered_by: string; created_at: string;
}
export interface Proposal {
  id: string; estate_id: string; item_id: string; action: ProposalAction; recipient_user_id: string | null;
  recipient_name: string | null; amount: number | string | null; organization: string | null; reason: string | null;
  rule: ApprovalRule; eligible_approvers: string[]; auto_approved: boolean; requested_by: string; created_at: string;
}
export interface ProposalDecision {
  id: string; estate_id: string; proposal_id: string; user_id: string; decision: Decision;
  comment: string | null; created_at: string;
}
export interface DecisionInvalidation {
  decision_id: string; estate_id: string; proposal_id: string; reason: string; invalidated_by: string; created_at: string;
}
export interface ProposalOutcomeRow {
  proposal_id: string; estate_id: string; item_id: string; outcome: ProposalOutcome; note: string | null;
  recorded_by: string | null; created_at: string;
}
export interface ProposalCompletion {
  proposal_id: string; estate_id: string; item_id: string; custody_event_id: string;
  final_amount: number | string | null; notes: string | null; completed_by: string; created_at: string;
}
export interface ProposalCancellation {
  proposal_id: string; estate_id: string; item_id: string; reason: string; cancelled_by: string; created_at: string;
}
export interface CustodyEvent {
  id: string; estate_id: string; item_id: string; event_type: CustodyEventType; from_location_id: string | null;
  to_location_id: string | null; released_by_user_id: string | null; received_by_user_id: string | null;
  received_by_name: string | null; purpose: string | null; occurred_at: string; notes: string | null;
  receipt_media_id: string | null; photo_media_id: string | null; proposal_id: string | null;
  recorded_by: string; created_at: string;
}
export interface GrabRound {
  id: string; estate_id: string; item_id: string; mode: ClaimMode; reveal_at: string | null;
  note: string | null; opened_by: string; created_at: string;
}
export interface GrabResolution {
  round_id: string; estate_id: string; item_id: string; method: ResolutionMethod; winner_user_id: string | null;
  reason: string | null; draw_seed: string | null; draw_candidates: string[] | null; proposal_id: string | null;
  resolved_by: string; created_at: string;
}
export interface Claim {
  id: string; estate_id: string; round_id: string; item_id: string; user_id: string; interest: Interest;
  note: string | null; created_at: string;
}
export interface Redaction { id: string; estate_id: string; media_id: string; reason: string; redacted_by: string; created_at: string }
export interface DuplicateReview {
  id: string; estate_id: string; item_id: string; other_item_id: string; verdict: DuplicateVerdict;
  reasons: string[]; note: string | null; decided_by: string; created_at: string;
}
export interface NumberReservation {
  id: string; estate_id: string; user_id: string; device_id: string; first_number: number; last_number: number; created_at: string;
}
export interface NumberVoid { estate_id: string; inventory_number: number; reservation_id: string; voided_by: string; reason: string; created_at: string }
export interface MediaVerification { id: number; estate_id: string; media_id: string; location: string; verified_sha256: string; matches: boolean; checked_at: string }
export interface LedgerEntry {
  estate_seq: number; entity: string; entity_id: string; item_id: string | null; action: 'INSERT' | 'UPDATE';
  actor_id: string | null; occurred_at: string; prev_hash: string; hash: string; payload: string | null;
}

/** Everything a device holds for one estate. */
export interface EstateData {
  estate: Estate | null;
  members: Member[];
  profiles: Profile[];
  invites: Invite[];
  locations: Location[];
  items: Item[];
  media: Media[];
  valuations: Valuation[];
  proposals: Proposal[];
  proposal_decisions: ProposalDecision[];
  decision_invalidations: DecisionInvalidation[];
  proposal_outcomes: ProposalOutcomeRow[];
  proposal_completions: ProposalCompletion[];
  proposal_cancellations: ProposalCancellation[];
  custody_events: CustodyEvent[];
  grab_rounds: GrabRound[];
  grab_resolutions: GrabResolution[];
  claims: Claim[];
  redactions: Redaction[];
  duplicate_reviews: DuplicateReview[];
  number_reservations: NumberReservation[];
  number_voids: NumberVoid[];
  media_verifications: MediaVerification[];
}

export function emptyEstateData(): EstateData {
  return {
    estate: null, members: [], profiles: [], invites: [], locations: [], items: [], media: [], valuations: [],
    proposals: [], proposal_decisions: [], decision_invalidations: [], proposal_outcomes: [],
    proposal_completions: [], proposal_cancellations: [], custody_events: [], grab_rounds: [],
    grab_resolutions: [], claims: [], redactions: [], duplicate_reviews: [], number_reservations: [],
    number_voids: [], media_verifications: [],
  };
}

// ---------------------------------------------------------------------------
// Plain-language labels (the doc's rule: no "asset disposition" in the UI)
// ---------------------------------------------------------------------------
export const STATUS_LABELS: Record<ItemStatus, string> = {
  DISCOVERED: 'Recorded',
  NEEDS_IDENTIFICATION: 'Needs identifying',
  NEEDS_VALUATION: 'Needs a value',
  NEEDS_DECISION: 'Needs a decision',
  UP_FOR_GRABS: 'Up for grabs',
  CLAIM_REQUESTED: 'Someone wants it',
  ASSIGNED: 'Assigned to family',
  APPROVAL_PENDING: 'Waiting for approval',
  APPROVED_FOR_SALE: 'Approved to sell',
  APPROVED_FOR_DONATION: 'Approved to donate',
  APPROVED_FOR_DISPOSAL: 'Approved to throw away',
  SOLD: 'Sold',
  DONATED: 'Donated',
  DISTRIBUTED: 'Given to family',
  DISPOSED: 'Thrown away or recycled',
  MISSING: 'Missing',
  ON_HOLD: 'On hold',
  MERGED: 'Duplicate (merged)',
};

export type Tone = 'neutral' | 'attention' | 'progress' | 'done' | 'warning';

export const STATUS_TONE: Record<ItemStatus, Tone> = {
  DISCOVERED: 'neutral', NEEDS_IDENTIFICATION: 'attention', NEEDS_VALUATION: 'attention', NEEDS_DECISION: 'attention',
  UP_FOR_GRABS: 'progress', CLAIM_REQUESTED: 'progress', ASSIGNED: 'progress', APPROVAL_PENDING: 'progress',
  APPROVED_FOR_SALE: 'progress', APPROVED_FOR_DONATION: 'progress', APPROVED_FOR_DISPOSAL: 'progress',
  SOLD: 'done', DONATED: 'done', DISTRIBUTED: 'done', DISPOSED: 'done', MISSING: 'warning', ON_HOLD: 'neutral',
  MERGED: 'neutral',
};

export const MANUAL_STATUSES: ItemStatus[] = ['DISCOVERED', 'NEEDS_IDENTIFICATION', 'NEEDS_VALUATION', 'NEEDS_DECISION', 'ON_HOLD'];
export const LEFT_ESTATE_STATUSES: ItemStatus[] = ['SOLD', 'DONATED', 'DISTRIBUTED', 'DISPOSED'];

export const ROLE_LABELS: Record<MemberRole, string> = {
  ADMINISTRATOR: 'Administrator', EXECUTOR: 'Executor', BENEFICIARY: 'Beneficiary',
  FAMILY_MEMBER: 'Family member', APPRAISER: 'Appraiser', VIEW_ONLY: 'View only',
};
export const ACTION_LABELS: Record<ProposalAction, string> = {
  ASSIGN: 'Give to a family member', SELL: 'Sell', DONATE: 'Donate', RECYCLE: 'Recycle', DISPOSE: 'Throw away',
};
export const ACTION_VERBS: Record<ProposalAction, string> = {
  ASSIGN: 'give', SELL: 'sell', DONATE: 'donate', RECYCLE: 'recycle', DISPOSE: 'throw away',
};
export const VALUATION_LABELS: Record<ValuationType, string> = {
  FAMILY_ESTIMATE: 'Family estimate', THIRD_PARTY_ESTIMATE: 'Outside estimate', FORMAL_APPRAISAL: 'Formal appraisal',
  DATE_OF_DEATH: 'Date-of-death value', INSURANCE: 'Insurance value', LISTING_PRICE: 'Asking price',
  SALE_PROCEEDS: 'Actual sale proceeds', DONATION_VALUE: 'Donation value',
};
export const CUSTODY_LABELS: Record<CustodyEventType, string> = {
  MOVED: 'Moved', HANDOFF: 'Handed off', SOLD: 'Sold', DONATED: 'Donated', DISPOSED: 'Thrown away or recycled',
  RETURNED: 'Returned', FOUND: 'Found', REPORTED_MISSING: 'Reported missing',
};
export const RESOLUTION_LABELS: Record<ResolutionMethod, string> = {
  SOLE_INTEREST: 'Only one person wanted it', DISCUSSION: 'Decided by family discussion', RANDOM_DRAW: 'Random draw',
  ROTATION: 'Rotating turns', INHERITANCE_CREDIT: 'Credited against inheritance', PURCHASE: 'Bought from the estate',
  NO_INTEREST: 'Nobody wanted it', CANCELLED: 'Round cancelled',
};
export const INTEREST_LABELS: Record<Interest, string> = {
  INTERESTED: 'I want it', NOT_INTERESTED: 'Not for me', NEED_INFO: 'I need more information',
};
export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  FULL_ITEM: 'Whole item', MARK: 'Maker or artist mark', SERIAL: 'Serial number', DAMAGE: 'Damage or condition',
  PACKAGING: 'Box or paperwork', RECEIPT: 'Receipt', DOCUMENT: 'Document', HANDOFF: 'Handoff photo',
  BARCODE: 'Barcode', OTHER: 'Other',
};
export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  PROPERTY: 'Property', AREA: 'Room or area', CONTAINER: 'Box or bin', STAGING: 'Staging area',
  HOLDING: 'Holding area', PERSON: "Someone's possession", EXTERNAL: 'Outside place',
};
export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  BARCODE: 'Same barcode', SERIAL: 'Same serial number', PHOTO: 'Same photo', NAME: 'Similar name in the same room',
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

export function memberName(userId: string | null | undefined, data: Pick<EstateData, 'profiles'>): string {
  if (!userId) return 'System';
  const p = data.profiles.find((x) => x.id === userId);
  return p?.display_name || p?.email || 'Unknown member';
}

export function isLiveItem(item: Item): boolean {
  return item.status !== 'MERGED';
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------
export function locationChain(id: string | null, locations: Map<string, Location>): Location[] {
  const chain: Location[] = [];
  let cur = id ? locations.get(id) : undefined;
  let guard = 0;
  while (cur && guard++ < 25) {
    chain.unshift(cur);
    cur = cur.parent_id ? locations.get(cur.parent_id) : undefined;
  }
  return chain;
}

export function locationPath(id: string | null, locations: Map<string, Location>): string {
  const chain = locationChain(id, locations);
  return chain.length ? chain.map((l) => l.name).join(' › ') : 'Not set';
}

export function isOnProperty(id: string | null, locations: Map<string, Location>): boolean {
  if (!id) return true;
  return !locationChain(id, locations).some((l) => l.kind === 'PERSON' || l.kind === 'EXTERNAL');
}

/** The room tag used in item codes for "where found" (mirrors private.found_tag). */
export function foundTag(id: string | null, locations: Map<string, Location>): string {
  const chain = locationChain(id, locations).reverse();
  return chain.find((l) => l.kind === 'AREA' || l.kind === 'PROPERTY')?.tag ?? chain[0]?.tag ?? 'XX';
}

/** Items currently in a place, including inside boxes within it. */
export function itemsIn(locationId: string, data: EstateData): Item[] {
  const locs = byId(data.locations);
  return data.items.filter(
    (i) => isLiveItem(i) && locationChain(i.current_location_id, locs).some((l) => l.id === locationId),
  );
}

// ---------------------------------------------------------------------------
// Valuations
// ---------------------------------------------------------------------------
const REFERENCE_ORDER: ValuationType[] = ['FORMAL_APPRAISAL', 'DATE_OF_DEATH', 'THIRD_PARTY_ESTIMATE', 'INSURANCE', 'FAMILY_ESTIMATE'];

export function currentValuations(itemId: string, valuations: Valuation[]): Valuation[] {
  const forItem = valuations.filter((v) => v.item_id === itemId);
  const superseded = new Set(forItem.map((v) => v.supersedes_id).filter(Boolean) as string[]);
  return forItem.filter((v) => !superseded.has(v.id));
}

/** The value used for approval thresholds (mirrors private.item_reference_value). */
export function referenceValue(itemId: string, valuations: Valuation[]): { amount: number; type: ValuationType } | null {
  const current = currentValuations(itemId, valuations).filter((v) => REFERENCE_ORDER.includes(v.valuation_type));
  current.sort(
    (a, b) =>
      REFERENCE_ORDER.indexOf(a.valuation_type) - REFERENCE_ORDER.indexOf(b.valuation_type) ||
      b.valuation_date.localeCompare(a.valuation_date) ||
      b.created_at.localeCompare(a.created_at),
  );
  const top = current[0];
  return top ? { amount: Number(top.amount), type: top.valuation_type } : null;
}

export function formatMoney(v: number | string | null | undefined, currency = 'USD'): string {
  const n = num(v);
  if (n === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
}

// ---------------------------------------------------------------------------
// Proposals (mirrors private.evaluate_proposal so devices show the same state)
// ---------------------------------------------------------------------------
export type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'COMPLETED' | 'CANCELLED';

export interface ProposalView {
  proposal: Proposal;
  status: ProposalStatus;
  outcome: ProposalOutcomeRow | null;
  completion: ProposalCompletion | null;
  cancellation: ProposalCancellation | null;
  effective: Map<string, ProposalDecision>;
  approvals: number;
  rejections: number;
  abstentions: number;
  eligible: string[];
  waitingOn: string[];
  invalidated: Set<string>;
}

export function proposalView(p: Proposal, data: EstateData): ProposalView {
  const outcome = data.proposal_outcomes.find((o) => o.proposal_id === p.id) ?? null;
  const completion = data.proposal_completions.find((c) => c.proposal_id === p.id) ?? null;
  const cancellation = data.proposal_cancellations.find((c) => c.proposal_id === p.id) ?? null;
  const invalidated = new Set(data.decision_invalidations.filter((i) => i.proposal_id === p.id).map((i) => i.decision_id));
  const active = new Set(data.members.filter((m) => m.is_active).map((m) => m.user_id));
  const eligible = p.eligible_approvers.filter((u) => active.has(u));
  const effective = new Map<string, ProposalDecision>();
  for (const d of data.proposal_decisions
    .filter((d) => d.proposal_id === p.id && !invalidated.has(d.id) && eligible.includes(d.user_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    effective.set(d.user_id, d);
  }
  let approvals = 0, rejections = 0, abstentions = 0;
  for (const d of effective.values()) {
    if (d.decision === 'APPROVE') approvals++;
    else if (d.decision === 'REJECT') rejections++;
    else abstentions++;
  }
  let status: ProposalStatus = 'PENDING';
  if (outcome?.outcome === 'REJECTED') status = 'REJECTED';
  else if (outcome?.outcome === 'WITHDRAWN') status = 'WITHDRAWN';
  else if (outcome?.outcome === 'APPROVED') status = completion ? 'COMPLETED' : cancellation ? 'CANCELLED' : 'APPROVED';
  const waitingOn = status === 'PENDING' ? eligible.filter((u) => !effective.has(u)) : [];
  return { proposal: p, status, outcome, completion, cancellation, effective, approvals, rejections, abstentions, eligible, waitingOn, invalidated };
}

/** Plain-language summary of what a proposal does: "Give to Blair", "Donate (Public library)". */
export function proposalSummary(
  p: Pick<Proposal, 'action' | 'recipient_user_id' | 'recipient_name' | 'organization'>,
  data: Pick<EstateData, 'profiles'>,
): string {
  if (p.action === 'ASSIGN') {
    const who = p.recipient_user_id ? memberName(p.recipient_user_id, data) : p.recipient_name;
    return who ? `Give to ${who}` : ACTION_LABELS.ASSIGN;
  }
  return p.organization ? `${ACTION_LABELS[p.action]} (${p.organization})` : ACTION_LABELS[p.action];
}

export function openProposalFor(itemId: string, data: EstateData): ProposalView | null {
  const candidates = data.proposals
    .filter((p) => p.item_id === itemId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((p) => proposalView(p, data));
  return candidates.find((v) => v.status === 'PENDING' || v.status === 'APPROVED') ?? null;
}

/** Who the item went (or is going) to, if assigned to a family member. */
export function assignedTo(itemId: string, data: EstateData): { userId: string | null; name: string | null; view: ProposalView } | null {
  const views = data.proposals
    .filter((p) => p.item_id === itemId && p.action === 'ASSIGN')
    .map((p) => proposalView(p, data))
    .filter((v) => v.status === 'APPROVED' || v.status === 'COMPLETED')
    .sort((a, b) => b.proposal.created_at.localeCompare(a.proposal.created_at));
  const v = views[0];
  return v ? { userId: v.proposal.recipient_user_id, name: v.proposal.recipient_name, view: v } : null;
}

// ---------------------------------------------------------------------------
// Up for grabs
// ---------------------------------------------------------------------------
export interface RoundView {
  round: GrabRound;
  resolution: GrabResolution | null;
  sealed: boolean;
  closed: boolean;
  revealAt: Date | null;
  latest: Map<string, Claim>;
  interested: string[];
  needInfo: string[];
  notInterested: string[];
  myClaim: Claim | null;
}

export function roundView(round: GrabRound, data: EstateData, me: string | null, now: Date = new Date()): RoundView {
  const resolution = data.grab_resolutions.find((r) => r.round_id === round.id) ?? null;
  const revealAt = round.reveal_at ? new Date(round.reveal_at) : null;
  const sealed = round.mode === 'SEALED' && !!revealAt && now < revealAt;
  const active = new Set(data.members.filter((m) => m.is_active).map((m) => m.user_id));
  const latest = new Map<string, Claim>();
  for (const c of data.claims.filter((c) => c.round_id === round.id).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    latest.set(c.user_id, c);
  }
  const by = (i: Interest) => [...latest.values()].filter((c) => c.interest === i && active.has(c.user_id)).map((c) => c.user_id).sort();
  return {
    round, resolution, sealed, closed: !!resolution, revealAt, latest,
    interested: by('INTERESTED'), needInfo: by('NEED_INFO'), notInterested: by('NOT_INTERESTED'),
    myClaim: me ? latest.get(me) ?? null : null,
  };
}

export function openRoundFor(itemId: string, data: EstateData, me: string | null, now = new Date()): RoundView | null {
  const r = data.grab_rounds
    .filter((x) => x.item_id === itemId && !data.grab_resolutions.some((g) => g.round_id === x.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return r ? roundView(r, data, me, now) : null;
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)) {
    const w = `  ${word} `;
    for (let i = 0; i < w.length - 2; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}

/** Trigram similarity in the style of PostgreSQL pg_trgm (0..1). */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a), tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const normalizeSerial = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

export interface DuplicateDraft {
  title: string;
  barcode?: string | null;
  serial_number?: string | null;
  found_location_id?: string | null;
  photoHashes?: string[];
}

export interface DuplicateCandidate {
  item: Item;
  reasons: DuplicateReason[];
  score: number;
}

/** Possible matches for an item about to be added (runs offline over local data). */
export function findDuplicateCandidates(draft: DuplicateDraft, data: EstateData, excludeItemId?: string): DuplicateCandidate[] {
  const locs = byId(data.locations);
  const draftRoom = draft.found_location_id ? foundTag(draft.found_location_id, locs) : null;
  const serial = normalizeSerial(draft.serial_number);
  const hashes = new Set(draft.photoHashes ?? []);
  const results: DuplicateCandidate[] = [];
  for (const item of data.items) {
    if (!isLiveItem(item) || item.id === excludeItemId) continue;
    const reasons: DuplicateReason[] = [];
    let score = 0;
    if (draft.barcode && item.barcode && draft.barcode.trim() === item.barcode.trim()) { reasons.push('BARCODE'); score += 0.6; }
    if (serial.length >= 4 && serial === normalizeSerial(item.serial_number)) { reasons.push('SERIAL'); score += 0.9; }
    if (hashes.size && data.media.some((m) => m.item_id === item.id && hashes.has(m.sha256))) { reasons.push('PHOTO'); score += 1; }
    const sim = similarity(draft.title, item.title);
    const sameRoom = !draftRoom || !item.original_location_id || foundTag(item.original_location_id, locs) === draftRoom;
    if (sim >= 0.55 && sameRoom) { reasons.push('NAME'); score += sim * 0.5; }
    if (reasons.length) results.push({ item, reasons, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

export interface DuplicatePair {
  item: Item;
  other: Item;
  reasons: DuplicateReason[];
  unsure: boolean;
}

/** All unreviewed possible duplicate pairs (newer record first). */
export function allPossibleDuplicates(data: EstateData): DuplicatePair[] {
  const reviewed = new Map<string, DuplicateVerdict>();
  for (const r of data.duplicate_reviews) {
    const key = [r.item_id, r.other_item_id].sort().join('|');
    reviewed.set(key, r.verdict);
  }
  const live = data.items.filter(isLiveItem).sort((a, b) => a.inventory_number - b.inventory_number);
  const pairs: DuplicatePair[] = [];
  const seen = new Set<string>();
  for (const item of live) {
    const photoHashes = data.media.filter((m) => m.item_id === item.id).map((m) => m.sha256);
    const cands = findDuplicateCandidates(
      { title: item.title, barcode: item.barcode, serial_number: item.serial_number, found_location_id: item.original_location_id, photoHashes },
      { ...data, items: live.filter((i) => i.inventory_number < item.inventory_number) },
      item.id,
    );
    for (const c of cands) {
      const key = [item.id, c.item.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const verdict = reviewed.get(key);
      if (verdict === 'DIFFERENT_ITEMS' || verdict === 'SAME_ITEM') continue;
      pairs.push({ item, other: c.item, reasons: c.reasons, unsure: verdict === 'UNSURE' });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Home screen summary and exceptions
// ---------------------------------------------------------------------------
export interface Summary {
  total: number;
  needsReview: number;
  valuables: number;
  upForGrabs: number;
  waitingApproval: number;
  assigned: number;
  soldOrDonated: number;
  leftEstate: number;
}

export function summarize(data: EstateData): Summary {
  const live = data.items.filter(isLiveItem);
  const count = (pred: (i: Item) => boolean) => live.filter(pred).length;
  return {
    total: live.length,
    needsReview: count((i) => ['DISCOVERED', 'NEEDS_IDENTIFICATION', 'NEEDS_VALUATION', 'NEEDS_DECISION'].includes(i.status)),
    valuables: count((i) => i.potentially_valuable),
    upForGrabs: count((i) => i.status === 'UP_FOR_GRABS' || i.status === 'CLAIM_REQUESTED'),
    waitingApproval: count((i) => i.status === 'APPROVAL_PENDING'),
    assigned: count((i) => i.status === 'ASSIGNED' || i.status === 'DISTRIBUTED'),
    soldOrDonated: count((i) => i.status === 'SOLD' || i.status === 'DONATED'),
    leftEstate: count((i) => LEFT_ESTATE_STATUSES.includes(i.status)),
  };
}

export type ExceptionType =
  | 'MISSING_PHOTO' | 'MISSING_VALUE' | 'REMOVED_WITHOUT_APPROVAL' | 'PENDING_DECISION'
  | 'VALUABLE_NOT_REVIEWED' | 'CONFLICTING_CLAIMS' | 'NOT_VERIFIED' | 'POSSIBLE_DUPLICATE' | 'MISSING_ITEM';

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  MISSING_PHOTO: 'No photograph',
  MISSING_VALUE: 'No value recorded',
  REMOVED_WITHOUT_APPROVAL: 'Removed without a completed approval',
  PENDING_DECISION: 'Decision waiting for approval',
  VALUABLE_NOT_REVIEWED: 'Possible valuable without an outside opinion',
  CONFLICTING_CLAIMS: 'More than one person wants it',
  NOT_VERIFIED: 'Not physically checked',
  POSSIBLE_DUPLICATE: 'Possible duplicate record',
  MISSING_ITEM: 'Reported missing',
};

export interface ExceptionRow { type: ExceptionType; item: Item; detail: string }

export function exceptions(data: EstateData, now = new Date()): ExceptionRow[] {
  const out: ExceptionRow[] = [];
  const locs = byId(data.locations);
  const redacted = new Set(data.redactions.map((r) => r.media_id));
  const live = data.items.filter(isLiveItem);
  for (const item of live) {
    const photos = data.media.filter((m) => m.item_id === item.id && !redacted.has(m.id) && m.mime_type.startsWith('image/'));
    if (!photos.length) out.push({ type: 'MISSING_PHOTO', item, detail: 'Add at least one photo.' });
    const vals = currentValuations(item.id, data.valuations);
    if (!vals.length && !LEFT_ESTATE_STATUSES.includes(item.status)) out.push({ type: 'MISSING_VALUE', item, detail: 'No estimate or appraisal yet.' });
    if (item.potentially_valuable && !vals.some((v) => v.valuation_type === 'FORMAL_APPRAISAL' || v.valuation_type === 'THIRD_PARTY_ESTIMATE')) {
      out.push({ type: 'VALUABLE_NOT_REVIEWED', item, detail: 'Flagged as possibly valuable; no appraisal or outside estimate.' });
    }
    if (!item.physically_verified_at && !LEFT_ESTATE_STATUSES.includes(item.status)) out.push({ type: 'NOT_VERIFIED', item, detail: 'Nobody has confirmed it is where the record says.' });
    if (item.status === 'MISSING') out.push({ type: 'MISSING_ITEM', item, detail: 'Reported missing.' });
    for (const ev of data.custody_events.filter((e) => e.item_id === item.id)) {
      if (!ev.proposal_id && (ev.event_type === 'HANDOFF' || !isOnProperty(ev.to_location_id, locs))) {
        const approved = data.proposals.some((p) => p.item_id === item.id && proposalView(p, data).status === 'COMPLETED');
        if (!approved) out.push({ type: 'REMOVED_WITHOUT_APPROVAL', item, detail: `${CUSTODY_LABELS[ev.event_type]} to ${locationPath(ev.to_location_id, locs)} on ${ev.occurred_at.slice(0, 10)}.` });
      }
    }
    const open = openProposalFor(item.id, data);
    if (open?.status === 'PENDING') out.push({ type: 'PENDING_DECISION', item, detail: `${ACTION_LABELS[open.proposal.action]}: waiting on ${open.waitingOn.length} approver(s).` });
    const round = openRoundFor(item.id, data, null, now);
    if (round && !round.sealed && round.interested.length > 1) out.push({ type: 'CONFLICTING_CLAIMS', item, detail: `${round.interested.length} people want this.` });
  }
  for (const pair of allPossibleDuplicates(data)) {
    out.push({ type: 'POSSIBLE_DUPLICATE', item: pair.item, detail: `May be the same as #${pair.other.inventory_number} (${pair.reasons.map((r) => DUPLICATE_REASON_LABELS[r]).join(', ')}).` });
  }
  return out;
}

/** Reserved numbers that were neither used nor voided (explains gaps). */
export function unusedReservedNumbers(data: EstateData): { number: number; reservation: NumberReservation }[] {
  const used = new Set(data.items.map((i) => i.inventory_number));
  const voided = new Set(data.number_voids.map((v) => v.inventory_number));
  const out: { number: number; reservation: NumberReservation }[] = [];
  for (const r of data.number_reservations) {
    for (let n = r.first_number; n <= r.last_number; n++) {
      if (!used.has(n) && !voided.has(n)) out.push({ number: n, reservation: r });
    }
  }
  return out;
}
