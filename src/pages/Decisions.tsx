import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ACTION_LABELS, DUPLICATE_REASON_LABELS, allPossibleDuplicates, byId, memberName, proposalView, roundView,
  type EstateData, type Item,
} from '../../supabase/functions/_shared/domain.ts';
import { Icon } from '../components/Icon';
import { EmptyState, Thumb, ToneChip } from '../components/ui';
import { useEstateData, useEstateId, useMe } from '../lib/hooks';

function ItemLine({ item, data, estateId, children }: { item: Item; data: EstateData; estateId: string; children?: ReactNode }) {
  const photo = data.media.find((m) => m.item_id === item.id && m.mime_type.startsWith('image/'));
  return (
    <li>
      <Link to={`/e/${estateId}/items/${item.id}`} className="flex gap-3 py-3">
        <Thumb media={photo} size={60} />
        <div className="min-w-0 flex-1">
          <p className="font-bold"><span className="tabular text-ink-soft">#{item.inventory_number}</span> {item.title}</p>
          <div className="text-[0.92rem] text-ink-soft">{children}</div>
        </div>
        <Icon name="forward" className="mt-4 text-ink-soft" />
      </Link>
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (!count) return null;
  return (
    <section className="mb-7">
      <h2 className="mb-2 flex items-center gap-2">{title} <span className="tabular rounded-full bg-sunk px-2.5 text-base">{count}</span></h2>
      <ul className="divide-y divide-line border-y border-line">{children}</ul>
    </section>
  );
}

export default function Decisions() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const me = useMe();
  const v = useMemo(() => {
    if (!data || !me) return null;
    const items = byId(data.items);
    const proposals = data.proposals.map((p) => proposalView(p, data)).filter((x) => items.has(x.proposal.item_id));
    const rounds = data.grab_rounds.map((r) => roundView(r, data, me)).filter((r) => !r.closed && items.has(r.round.item_id));
    return {
      items,
      myVotes: proposals.filter((p) => p.status === 'PENDING' && p.waitingOn.includes(me)),
      waiting: proposals.filter((p) => p.status === 'PENDING' && !p.waitingOn.includes(me)),
      approved: proposals.filter((p) => p.status === 'APPROVED'),
      toAnswer: rounds.filter((r) => (r.round.mode === 'OPEN' || r.sealed) && !r.myClaim),
      sealedAnswered: rounds.filter((r) => r.sealed && r.myClaim),
      toSettle: rounds.filter((r) => !r.sealed && (r.round.mode === 'SEALED' || r.interested.length > 0)),
      conflicts: rounds.filter((r) => !r.sealed && r.interested.length > 1),
      dupes: allPossibleDuplicates(data),
    };
  }, [data, me]);
  if (!data || !v) return null;
  const total = v.myVotes.length + v.waiting.length + v.approved.length + v.toAnswer.length + v.sealedAnswered.length + v.toSettle.length + v.dupes.length;
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

  return (
    <div>
      <h1 className="mb-5">Decisions</h1>
      {total === 0 && (
        <EmptyState icon="scale" title="Nothing is waiting">
          When someone proposes what happens to an item, or puts something up for grabs, it shows up here.
        </EmptyState>
      )}

      <Section title="Your approval is needed" count={v.myVotes.length}>
        {v.myVotes.map((p) => (
          <ItemLine key={p.proposal.id} item={v.items.get(p.proposal.item_id)!} data={data} estateId={estateId}>
            {ACTION_LABELS[p.proposal.action]}{p.proposal.recipient_user_id ? ` to ${memberName(p.proposal.recipient_user_id, data)}` : ''}. Proposed by {memberName(p.proposal.requested_by, data)}.
          </ItemLine>
        ))}
      </Section>

      <Section title="Up for grabs: give your answer" count={v.toAnswer.length}>
        {v.toAnswer.map((r) => (
          <ItemLine key={r.round.id} item={v.items.get(r.round.item_id)!} data={data} estateId={estateId}>
            {r.sealed ? `Sealed until ${fmt(r.round.reveal_at)}` : `${r.interested.length} interested so far`}
          </ItemLine>
        ))}
      </Section>

      <Section title="More than one person wants it" count={v.conflicts.length}>
        {v.conflicts.map((r) => (
          <ItemLine key={r.round.id} item={v.items.get(r.round.item_id)!} data={data} estateId={estateId}>
            Wanted by {r.interested.map((u) => memberName(u, data)).join(', ')}. Settle by discussion, random draw, turns, credit, or purchase.
          </ItemLine>
        ))}
      </Section>

      <Section title="Ready to settle" count={v.toSettle.filter((r) => r.interested.length <= 1).length}>
        {v.toSettle.filter((r) => r.interested.length <= 1).map((r) => (
          <ItemLine key={r.round.id} item={v.items.get(r.round.item_id)!} data={data} estateId={estateId}>
            {r.interested.length === 1 ? `Only ${memberName(r.interested[0], data)} wants it.` : 'Nobody wants it.'}
          </ItemLine>
        ))}
      </Section>

      <Section title="Approved, not done yet" count={v.approved.length}>
        {v.approved.map((p) => (
          <ItemLine key={p.proposal.id} item={v.items.get(p.proposal.item_id)!} data={data} estateId={estateId}>
            {ACTION_LABELS[p.proposal.action]}{p.proposal.recipient_user_id ? ` to ${memberName(p.proposal.recipient_user_id, data)}` : ''}. Record it when it happens.
          </ItemLine>
        ))}
      </Section>

      <Section title="Waiting for others" count={v.waiting.length}>
        {v.waiting.map((p) => (
          <ItemLine key={p.proposal.id} item={v.items.get(p.proposal.item_id)!} data={data} estateId={estateId}>
            {ACTION_LABELS[p.proposal.action]}. Waiting on {p.waitingOn.map((u) => memberName(u, data)).join(', ') || 'no one'}.
          </ItemLine>
        ))}
      </Section>

      <Section title="Your sealed answers" count={v.sealedAnswered.length}>
        {v.sealedAnswered.map((r) => (
          <ItemLine key={r.round.id} item={v.items.get(r.round.item_id)!} data={data} estateId={estateId}>
            Revealed {fmt(r.round.reveal_at)}. You can change your answer until then.
          </ItemLine>
        ))}
      </Section>

      <Section title="Possible duplicates to check" count={v.dupes.length}>
        {v.dupes.map((d) => (
          <ItemLine key={`${d.item.id}-${d.other.id}`} item={d.item} data={data} estateId={estateId}>
            May be the same as #{d.other.inventory_number} {d.other.title} ({d.reasons.map((r) => DUPLICATE_REASON_LABELS[r].toLowerCase()).join(', ')}).
            {d.unsure && <span className="ml-1"><ToneChip tone="attention">Marked “not sure”</ToneChip></span>}
          </ItemLine>
        ))}
      </Section>

      {v.myVotes.length === 0 && total > 0 && <p className="text-ink-soft">Nothing needs your approval right now.</p>}
    </div>
  );
}
