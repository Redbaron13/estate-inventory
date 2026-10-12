import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CATEGORIES, parseItemCode } from '../../supabase/functions/_shared/codes.ts';
import {
  STATUS_LABELS, byId, isLiveItem, locationChain, locationPath, memberName, assignedTo,
  type Item, type ItemStatus,
} from '../../supabase/functions/_shared/domain.ts';
import { Icon } from '../components/Icon';
import { placeOptions } from '../components/pickers';
import { CodeTag, EmptyState, PendingMarker, StatusChip, Thumb } from '../components/ui';
import { useEstateData, useEstateId } from '../lib/hooks';

const FILTERS: { key: string; label: string; test: (i: Item) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'review', label: 'Needs review', test: (i) => ['DISCOVERED', 'NEEDS_IDENTIFICATION', 'NEEDS_VALUATION', 'NEEDS_DECISION'].includes(i.status) },
  { key: 'info', label: 'Needs information', test: (i) => i.status === 'NEEDS_IDENTIFICATION' || i.title.startsWith('Item with barcode') },
  { key: 'valuable', label: 'Valuables', test: (i) => i.potentially_valuable },
  { key: 'grabs', label: 'Up for grabs', test: (i) => i.status === 'UP_FOR_GRABS' || i.status === 'CLAIM_REQUESTED' },
  { key: 'pending', label: 'Waiting for approval', test: (i) => i.status === 'APPROVAL_PENDING' },
  { key: 'assigned', label: 'Assigned', test: (i) => i.status === 'ASSIGNED' || i.status === 'DISTRIBUTED' },
  { key: 'gone', label: 'Sold, donated, disposed', test: (i) => ['SOLD', 'DONATED', 'DISPOSED'].includes(i.status) },
  { key: 'hold', label: 'Hold in place', test: (i) => i.do_not_move },
  { key: 'missing', label: 'Missing', test: (i) => i.status === 'MISSING' },
];

export default function Inventory() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [limit, setLimit] = useState(100);
  const filter = params.get('filter') ?? 'all';
  const place = params.get('place') ?? '';
  const category = params.get('category') ?? '';
  const status = params.get('status') ?? '';
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const results = useMemo(() => {
    if (!data) return [];
    const locs = byId(data.locations);
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
    const term = q.trim().toLowerCase();
    const code = parseItemCode(q)?.code;
    return data.items
      .filter(isLiveItem)
      .filter(f.test)
      .filter((i) => !place || locationChain(i.current_location_id, locs).some((l) => l.id === place) || locationChain(i.original_location_id, locs).some((l) => l.id === place))
      .filter((i) => !category || i.category === category)
      .filter((i) => !status || i.status === status)
      .filter((i) => {
        if (!term) return true;
        if (code) return i.item_code === code;
        if (/^\d+$/.test(term) && (String(i.inventory_number) === String(Number(term)) || i.barcode === term)) return true;
        const assigned = assignedTo(i.id, data);
        const hay = [
          i.title, i.description, i.item_code, i.barcode, i.brand, i.model, i.serial_number, i.notes, i.markings,
          locationPath(i.current_location_id, locs), locationPath(i.original_location_id, locs),
          memberName(i.created_by, data), assigned?.userId ? memberName(assigned.userId, data) : assigned?.name,
        ].filter(Boolean).join(' ').toLowerCase();
        return term.split(/\s+/).every((w) => hay.includes(w));
      })
      .sort((a, b) => a.inventory_number - b.inventory_number);
  }, [data, filter, q, place, category, status]);

  if (!data) return null;
  const locs = byId(data.locations);
  const redacted = new Set(data.redactions.map((r) => r.media_id));
  const firstPhoto = (id: string) => data.media.find((m) => m.item_id === id && !redacted.has(m.id) && m.mime_type.startsWith('image/'));

  return (
    <div>
      <h1 className="mb-4">Inventory</h1>
      <div className="relative mb-3">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
        <label htmlFor="search" className="sr-only">Search</label>
        <input
          id="search"
          type="search"
          className="input pl-11"
          placeholder="Description, room, code, barcode, person, number"
          value={q}
          onChange={(e) => { setQ(e.target.value); setLimit(100); }}
        />
      </div>

      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setParam('filter', f.key === 'all' ? '' : f.key)}
            className={`chip min-h-10 shrink-0 border-2 px-3 ${filter === f.key ? 'border-action bg-action text-on-action' : 'border-line bg-surface text-ink'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <details className="mb-4">
        <summary className="cursor-pointer py-2 font-bold text-action">By room, kind or status</summary>
        <div className="grid gap-3 pt-2 sm:grid-cols-3">
          <select className="input" value={place} onChange={(e) => setParam('place', e.target.value)} aria-label="Room or place">
            <option value="">Any place</option>
            {placeOptions(data.locations).map(({ loc, depth, path }) => (
              <option key={loc.id} value={loc.id}>{' '.repeat(depth)}{path[path.length - 1]}</option>
            ))}
          </select>
          <select className="input" value={category} onChange={(e) => setParam('category', e.target.value)} aria-label="Kind of item">
            <option value="">Any kind</option>
            {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <select className="input" value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABELS) as ItemStatus[]).filter((s) => s !== 'MERGED').map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </details>

      <p className="mb-2 text-ink-soft" aria-live="polite">{results.length} item{results.length === 1 ? '' : 's'}</p>

      {results.length === 0 ? (
        <EmptyState icon="search" title="Nothing matches" action={<Link to={`/e/${estateId}/add`} className="btn btn-primary"><Icon name="camera" /> Add an item</Link>}>
          Try fewer words, or clear the filters.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {results.slice(0, limit).map((i) => (
            <li key={i.id}>
              <Link to={`/e/${estateId}/items/${i.id}`} className="flex gap-3 py-3">
                <Thumb media={firstPhoto(i.id)} size={68} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-snug">
                    <span className="tabular text-ink-soft">#{i.inventory_number}</span> {i.title}
                    {i.quantity > 1 && <span className="text-ink-soft"> ×{i.quantity}</span>}
                  </p>
                  <p className="truncate text-[0.9rem] text-ink-soft">{locationPath(i.current_location_id, locs)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StatusChip status={i.status} />
                    {i.potentially_valuable && <span className="chip tone-attention"><Icon name="star" size={14} />Valuable?</span>}
                    {i.do_not_move && <span className="chip tone-warning"><Icon name="pin" size={14} />Hold</span>}
                    <PendingMarker entityId={i.id} />
                  </div>
                </div>
                <div className="hidden sm:block"><CodeTag code={i.item_code} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {results.length > limit && (
        <button type="button" className="btn btn-secondary btn-block mt-4" onClick={() => setLimit((l) => l + 200)}>Show more</button>
      )}
    </div>
  );
}
