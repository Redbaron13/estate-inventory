import { useMemo, useState } from 'react';
import { CATEGORIES, type LocationKind } from '../../supabase/functions/_shared/codes.ts';
import {
  LOCATION_KIND_LABELS, ROLE_LABELS, byId, locationChain, type EstateData, type Location,
} from '../../supabase/functions/_shared/domain.ts';
import { createLocation } from '../lib/actions';
import { Icon } from './Icon';

export function CategoryPicker({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {CATEGORIES.map((c) => (
        <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
      ))}
    </select>
  );
}

/** Places listed as an indented outline, so "Basement › Shelf 3" reads naturally. */
export function placeOptions(locations: Location[], filter?: (l: Location) => boolean) {
  const live = locations.filter((l) => !l.archived_at && (!filter || filter(l)));
  const map = byId(locations);
  return live
    .map((l) => ({ loc: l, path: locationChain(l.id, map).map((x) => x.name), depth: locationChain(l.id, map).length - 1 }))
    .sort((a, b) => a.path.join('\u0000').localeCompare(b.path.join('\u0000')));
}

export function LocationPicker({
  data, value, onChange, id, kinds, allowNone, noneLabel = 'Not sure', allowCreate = true, createKind = 'AREA',
}: {
  data: EstateData;
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
  kinds?: LocationKind[];
  allowNone?: boolean;
  noneLabel?: string;
  allowCreate?: boolean;
  createKind?: LocationKind;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind>(createKind);
  const [parent, setParent] = useState<string | null>(value);
  const options = useMemo(() => placeOptions(data.locations, (l) => !kinds || kinds.includes(l.kind)), [data.locations, kinds]);
  const parents = useMemo(() => placeOptions(data.locations, (l) => !['PERSON', 'EXTERNAL'].includes(l.kind)), [data.locations]);

  async function add() {
    if (!name.trim() || !data.estate) return;
    const loc = await createLocation(data.estate.id, { name, kind, parentId: parent });
    onChange(loc.id);
    setAdding(false);
    setName('');
  }

  return (
    <div>
      <div className="flex gap-2">
        <select id={id} className="input flex-1" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          {allowNone && <option value="">{noneLabel}</option>}
          {!allowNone && !value && <option value="">Choose a place</option>}
          {options.map(({ loc, depth, path }) => (
            <option key={loc.id} value={loc.id}>
              {' '.repeat(depth)}{path[path.length - 1]}{loc.kind === 'CONTAINER' || loc.kind === 'STAGING' || loc.kind === 'HOLDING' ? ` (${LOCATION_KIND_LABELS[loc.kind].toLowerCase()})` : ''}
            </option>
          ))}
        </select>
        {allowCreate && (
          <button type="button" className="btn btn-secondary px-3" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <Icon name="plus" />
            <span className="sr-only">Add a new place</span>
          </button>
        )}
      </div>
      {adding && (
        <div className="panel mt-3 p-4">
          <label className="field-label" htmlFor={`${id}-new`}>New place</label>
          <input id={`${id}-new`} className="input mb-3" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hall closet, Box 12" autoFocus />
          <div className="mb-3 grid grid-cols-2 gap-2">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as LocationKind)} aria-label="Kind of place">
              {(['AREA', 'CONTAINER', 'STAGING', 'HOLDING'] as LocationKind[]).map((k) => (
                <option key={k} value={k}>{LOCATION_KIND_LABELS[k]}</option>
              ))}
            </select>
            <select className="input" value={parent ?? ''} onChange={(e) => setParent(e.target.value || null)} aria-label="Inside">
              <option value="">Not inside anything</option>
              {parents.map(({ loc, depth, path }) => (
                <option key={loc.id} value={loc.id}>Inside: {' '.repeat(depth)}{path[path.length - 1]}</option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={add} disabled={!name.trim()}>Add place</button>
        </div>
      )}
    </div>
  );
}

export function MemberPicker({ data, value, onChange, id, exclude = [], allowNone = false }: { data: EstateData; value: string | null; onChange: (v: string | null) => void; id?: string; exclude?: string[]; allowNone?: boolean }) {
  const members = data.members.filter((m) => m.is_active && !exclude.includes(m.user_id));
  return (
    <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {(allowNone || !value) && <option value="">{allowNone ? 'Nobody' : 'Choose a person'}</option>}
      {members.map((m) => {
        const p = data.profiles.find((x) => x.id === m.user_id);
        return <option key={m.user_id} value={m.user_id}>{p?.display_name || p?.email} ({ROLE_LABELS[m.role].toLowerCase()})</option>;
      })}
    </select>
  );
}
