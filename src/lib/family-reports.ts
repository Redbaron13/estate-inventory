import { assignedTo, byId, isLiveItem, locationPath, memberName, referenceValue, roundView, type EstateData } from '../../supabase/functions/_shared/domain.ts';
import type { Table } from '../../supabase/functions/_shared/reports.ts';

/** Never infer a missing choice as disinterest, or reveal a sealed round from a local cache. */
export function familyChoicesReport(data: EstateData, now = new Date()): Table {
  const locations = byId(data.locations);
  const people = data.members.filter(m => m.is_active && !['VIEW_ONLY', 'APPRAISER'].includes(m.role));
  const rows: Table['rows'] = [];
  const rounds = new Map<string, EstateData['grab_rounds'][number]>();
  for (const round of data.grab_rounds) {
    if (!rounds.has(round.item_id) || rounds.get(round.item_id)!.created_at < round.created_at) rounds.set(round.item_id, round);
  }
  for (const item of data.items.filter(isLiveItem).sort((a, b) => a.inventory_number - b.inventory_number)) {
    const round = rounds.get(item.id);
    const view = round ? roundView(round, data, null, now) : null;
    for (const person of people) {
      const claim = view?.sealed ? undefined : view?.latest.get(person.user_id);
      const label = !round ? 'Not opened for family choices' : view?.sealed ? 'Sealed until reveal' : !claim ? 'No response recorded' : ({ INTERESTED: 'I want it', NOT_INTERESTED: 'Not for me', NEED_INFO: 'Discuss first' })[claim.interest];
      rows.push([item.inventory_number, item.item_code, item.title, locationPath(item.original_location_id, locations), memberName(person.user_id, data), person.user_id, label, claim?.note ?? '', round?.id ?? '', view?.sealed ? round?.reveal_at ?? '' : claim?.created_at ?? '']);
    }
  }
  return { title: 'Family choices (latest round per item)', headers: ['Inventory #', 'Item code', 'Description', 'Found in', 'Family member', 'Member ID', 'Choice', 'Note', 'Round ID', 'Response or reveal time'], rows };
}

/** Group by stable identity, not display name. Unknown values remain explicitly unknown. */
export function beneficiarySummaryReport(data: EstateData): Table {
  const people = new Map<string, { name: string; id: string; assigned: number; delivered: number; known: number; unknown: number }>();
  for (const member of data.members.filter(m => m.is_active && m.role === 'BENEFICIARY')) {
    people.set(member.user_id, { name: memberName(member.user_id, data), id: member.user_id, assigned: 0, delivered: 0, known: 0, unknown: 0 });
  }
  for (const item of data.items.filter(isLiveItem)) {
    const assignment = assignedTo(item.id, data);
    if (!assignment) continue;
    const p = assignment.view.proposal;
    const key = assignment.userId ?? `external:${assignment.name ?? 'unknown'}`;
    const person = people.get(key) ?? { name: assignment.userId ? memberName(assignment.userId, data) : assignment.name ?? 'Unknown', id: assignment.userId ?? 'External recipient', assigned: 0, delivered: 0, known: 0, unknown: 0 };
    person.assigned++;
    if (assignment.view.status === 'COMPLETED') person.delivered++;
    const value = p.amount !== null ? Number(p.amount) : referenceValue(item.id, data.valuations)?.amount;
    if (value === undefined || !Number.isFinite(value)) person.unknown++;
    else person.known += value;
    people.set(key, person);
  }
  return {
    title: 'Beneficiary distribution summary',
    headers: ['Family member', 'Member ID', 'Assigned item records', 'Transferred item records', 'Awaiting handoff', 'Known assigned value (USD)', 'Items without a value'],
    rows: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map(p => [p.name, p.id, p.assigned, p.delivered, p.assigned - p.delivered, p.known.toFixed(2), p.unknown]),
  };
}
