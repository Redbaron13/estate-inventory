// Report builders shared by the web app (offline CSV/PDF) and the API (CSV).
import { categoryLabel } from './codes.ts';
import {
  ACTION_LABELS, CUSTODY_LABELS, EXCEPTION_LABELS, LEFT_ESTATE_STATUSES, RESOLUTION_LABELS, STATUS_LABELS,
  VALUATION_LABELS, assignedTo, byId, currentValuations, exceptions, formatMoney, isLiveItem, locationPath,
  memberName, proposalView, referenceValue,
  type EstateData, type Item, type LedgerEntry, type ValuationType,
} from './domain.ts';

export interface Table {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

export function toCSV(table: Table): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Leading BOM so Excel opens UTF-8 correctly.
  return '﻿' + [table.headers, ...table.rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

function finalDisposition(item: Item, data: EstateData): string {
  if (!LEFT_ESTATE_STATUSES.includes(item.status)) return '';
  const done = data.proposals
    .filter((p) => p.item_id === item.id)
    .map((p) => proposalView(p, data))
    .find((v) => v.status === 'COMPLETED');
  if (!done) return STATUS_LABELS[item.status];
  const p = done.proposal;
  const who = p.action === 'ASSIGN' ? memberName(p.recipient_user_id, data) : p.organization ?? p.recipient_name ?? '';
  return `${STATUS_LABELS[item.status]}${who ? ` — ${who}` : ''} (${dateOnly(done.completion?.created_at)})`;
}

export function inventoryReport(data: EstateData): Table {
  const locs = byId(data.locations);
  const items = data.items.filter(isLiveItem).sort((a, b) => a.inventory_number - b.inventory_number);
  return {
    title: 'Inventory',
    headers: [
      'Inventory #', 'Item code', 'Description', 'Category', 'Quantity', 'Found in', 'Current location', 'Condition',
      'Status', 'Value', 'Value basis', 'Assigned to', 'Final disposition', 'Photos', 'Hold in place', 'Possibly valuable',
    ],
    rows: items.map((i) => {
      const ref = referenceValue(i.id, data.valuations);
      const assigned = assignedTo(i.id, data);
      return [
        i.inventory_number, i.item_code, i.title, categoryLabel(i.category), i.quantity,
        locationPath(i.original_location_id, locs), locationPath(i.current_location_id, locs), i.condition ?? '',
        STATUS_LABELS[i.status], ref ? ref.amount.toFixed(2) : '', ref ? VALUATION_LABELS[ref.type] : '',
        assigned ? (assigned.userId ? memberName(assigned.userId, data) : assigned.name ?? '') : '',
        finalDisposition(i, data), data.media.filter((m) => m.item_id === i.id).length,
        i.do_not_move ? 'Yes' : '', i.potentially_valuable ? 'Yes' : '',
      ];
    }),
  };
}

export function valuationReport(data: EstateData): Table {
  const items = data.items.filter(isLiveItem);
  const sums = new Map<ValuationType, { count: number; total: number }>();
  let unvalued = 0;
  for (const i of items) {
    const current = currentValuations(i.id, data.valuations);
    if (!current.length) unvalued++;
    // Latest value of each type per item, so a corrected estimate is not double-counted.
    const latest = new Map<ValuationType, number>();
    for (const v of current.sort((a, b) => a.created_at.localeCompare(b.created_at))) latest.set(v.valuation_type, Number(v.amount));
    for (const [type, amount] of latest) {
      const s = sums.get(type) ?? { count: 0, total: 0 };
      s.count++; s.total += amount;
      sums.set(type, s);
    }
  }
  const order: ValuationType[] = ['FAMILY_ESTIMATE', 'THIRD_PARTY_ESTIMATE', 'FORMAL_APPRAISAL', 'DATE_OF_DEATH', 'INSURANCE', 'LISTING_PRICE', 'SALE_PROCEEDS', 'DONATION_VALUE'];
  return {
    title: 'Valuation summary',
    headers: ['Kind of value', 'Items', 'Total'],
    rows: [
      ['Items with no value recorded', unvalued, ''],
      ...order.map((t) => [VALUATION_LABELS[t], sums.get(t)?.count ?? 0, formatMoney(sums.get(t)?.total ?? 0)]),
    ],
  };
}

export function distributionReport(data: EstateData): Table {
  const rows: (string | number)[][] = [];
  const views = data.proposals
    .filter((p) => p.action === 'ASSIGN')
    .map((p) => proposalView(p, data))
    .filter((v) => v.status === 'APPROVED' || v.status === 'COMPLETED');
  const itemsById = byId(data.items);
  const byPerson = new Map<string, typeof views>();
  for (const v of views) {
    const key = v.proposal.recipient_user_id ? memberName(v.proposal.recipient_user_id, data) : v.proposal.recipient_name ?? 'Unknown';
    byPerson.set(key, [...(byPerson.get(key) ?? []), v]);
  }
  for (const [person, list] of [...byPerson].sort((a, b) => a[0].localeCompare(b[0]))) {
    let total = 0;
    for (const v of list) {
      const item = itemsById.get(v.proposal.item_id);
      if (!item) continue;
      const value = v.proposal.amount !== null ? Number(v.proposal.amount) : referenceValue(item.id, data.valuations)?.amount ?? 0;
      total += value;
      const custody = data.custody_events.find((e) => e.id === v.completion?.custody_event_id);
      rows.push([
        person, item.inventory_number, item.item_code, item.title, value ? value.toFixed(2) : '',
        v.status === 'COMPLETED' ? dateOnly(custody?.occurred_at ?? v.completion?.created_at) : 'Not yet handed off',
        custody?.receipt_media_id || custody?.photo_media_id ? 'Yes' : '',
        [...v.effective.values()].filter((d) => d.decision === 'APPROVE').map((d) => memberName(d.user_id, data)).join('; ')
          || (v.proposal.auto_approved ? 'Automatic (below threshold)' : ''),
      ]);
    }
    rows.push([`${person} — total`, '', '', '', total.toFixed(2), '', '', '']);
  }
  return {
    title: 'Distribution by family member',
    headers: ['Family member', 'Inventory #', 'Item code', 'Description', 'Assigned value', 'Date transferred', 'Receipt or photo', 'Approved by'],
    rows,
  };
}

export function exceptionsReport(data: EstateData): Table {
  return {
    title: 'Exceptions',
    headers: ['Issue', 'Inventory #', 'Item code', 'Description', 'Detail'],
    rows: exceptions(data).map((e) => [EXCEPTION_LABELS[e.type], e.item.inventory_number, e.item.item_code, e.item.title, e.detail]),
  };
}

// ---------------------------------------------------------------------------
// Activity ledger in plain language
// ---------------------------------------------------------------------------
const FIELD_LABELS: Record<string, string> = {
  title: 'description', description: 'details', category: 'category', quantity: 'quantity', condition: 'condition',
  barcode: 'barcode', brand: 'brand', model: 'model', serial_number: 'serial number', notes: 'notes',
  status: 'status', current_location_id: 'location', original_location_id: 'where found',
  potentially_valuable: 'valuable flag', do_not_move: 'hold in place', physically_verified_at: 'physical check',
  markings: 'markings', provenance: 'history', dimensions: 'dimensions', weight: 'weight', merged_into_id: 'merge',
};

export function describeLedgerEntry(e: LedgerEntry, data: EstateData): string {
  if (e.payload === null) {
    return e.entity === 'claims' ? 'Sealed choice recorded (revealed when the round closes)' : 'Details visible to managers only';
  }
  let p: { before: Record<string, unknown> | null; after: Record<string, unknown> | null };
  try {
    p = JSON.parse(e.payload);
  } catch {
    return `${e.action} ${e.entity}`;
  }
  const a = (p.after ?? {}) as Record<string, any>;
  const b = (p.before ?? {}) as Record<string, any>;
  const itemRef = () => {
    const item = data.items.find((i) => i.id === (a.item_id ?? (e.entity === 'items' ? a.id : null)));
    return item ? `#${item.inventory_number} ${item.title}` : 'an item';
  };
  switch (e.entity) {
    case 'estates':
      return e.action === 'INSERT' ? `Created the estate "${a.name}"` : 'Changed estate settings';
    case 'estate_members':
      if (e.action === 'INSERT') return `${memberName(a.user_id, data)} joined as ${String(a.role).toLowerCase().replace('_', ' ')}`;
      if (b.is_active && !a.is_active) return `${memberName(a.user_id, data)} was removed (${a.removal_reason ?? 'no reason'})`;
      return `Changed ${memberName(a.user_id, data)}'s role or permissions`;
    case 'estate_invites':
      return e.action === 'INSERT' ? `Invited ${a.email}` : a.accepted_at && !b.accepted_at ? `${a.email} accepted the invitation` : 'Cancelled an invitation';
    case 'locations':
      return e.action === 'INSERT' ? `Added place "${a.name}" (${a.code})` : `Changed place "${a.name}"`;
    case 'items': {
      if (e.action === 'INSERT') return `Added #${a.inventory_number} ${a.title} (${a.item_code})`;
      const changed = Object.keys(a).filter((k) => !['updated_at', 'updated_by', 'version'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      if (changed.includes('status') && changed.length <= 2) {
        return `#${a.inventory_number}: ${STATUS_LABELS[b.status as keyof typeof STATUS_LABELS] ?? b.status} → ${STATUS_LABELS[a.status as keyof typeof STATUS_LABELS] ?? a.status}`;
      }
      return `Edited #${a.inventory_number} (${changed.map((k) => FIELD_LABELS[k] ?? k).join(', ')})`;
    }
    case 'media': return `Added a photo or file to ${itemRef()}`;
    case 'valuations': return `${VALUATION_LABELS[a.valuation_type as ValuationType]} of ${formatMoney(a.amount)} for ${itemRef()}${a.supersedes_id ? ' (correction)' : ''}`;
    case 'proposals': return `Proposed: ${ACTION_LABELS[a.action as keyof typeof ACTION_LABELS]} — ${itemRef()}${a.recipient_user_id ? ` to ${memberName(a.recipient_user_id, data)}` : a.organization ? ` (${a.organization})` : ''}`;
    case 'proposal_decisions': return `${memberName(a.user_id, data)} ${a.decision === 'APPROVE' ? 'approved' : a.decision === 'REJECT' ? 'rejected' : 'abstained on'} a decision${a.comment ? `: "${a.comment}"` : ''}`;
    case 'decision_invalidations': return `A decision was set aside: ${a.reason}`;
    case 'proposal_outcomes': return `Decision ${String(a.outcome).toLowerCase()} — ${itemRef()}`;
    case 'proposal_completions': return `Completed — ${itemRef()}`;
    case 'proposal_cancellations': return `Approved decision cancelled — ${itemRef()}: ${a.reason}`;
    case 'custody_events': return `${CUSTODY_LABELS[a.event_type as keyof typeof CUSTODY_LABELS]} — ${itemRef()}${a.received_by_name ? ` (received by ${a.received_by_name})` : a.received_by_user_id ? ` (received by ${memberName(a.received_by_user_id, data)})` : ''}`;
    case 'grab_rounds': return `${itemRef()} is up for grabs${a.mode === 'SEALED' ? ' (sealed choices)' : ''}`;
    case 'grab_resolutions': return `Round settled — ${itemRef()}: ${RESOLUTION_LABELS[a.method as keyof typeof RESOLUTION_LABELS]}${a.winner_user_id ? ` → ${memberName(a.winner_user_id, data)}` : ''}`;
    case 'claims': return `${memberName(a.user_id, data)} chose "${String(a.interest).toLowerCase().replace('_', ' ')}" for ${itemRef()}`;
    case 'redactions': return `A file was hidden: ${a.reason}`;
    case 'duplicate_reviews': return `Duplicate check on ${itemRef()}: ${String(a.verdict).toLowerCase().replace('_', ' ')}`;
    case 'number_reservations': return `${memberName(a.user_id, data)}'s device reserved numbers ${a.first_number}–${a.last_number}`;
    case 'number_voids': return `Number ${a.inventory_number} voided: ${a.reason}`;
    case 'media_verifications': return `Backup check of a file: ${a.matches ? 'matches' : 'MISMATCH'}`;
    default: return `${e.action} ${e.entity}`;
  }
}

export function activityReport(entries: LedgerEntry[], data: EstateData): Table {
  return {
    title: 'Activity ledger',
    headers: ['#', 'When (UTC)', 'Who', 'What happened', 'Fingerprint'],
    rows: entries.map((e) => [
      e.estate_seq, e.occurred_at.replace('T', ' ').slice(0, 19), memberName(e.actor_id, data),
      describeLedgerEntry(e, data), e.hash.slice(0, 16),
    ]),
  };
}
