import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LocationKind } from '../../supabase/functions/_shared/codes.ts';
import { LOCATION_KIND_LABELS, byId, itemsIn, locationPath } from '../../supabase/functions/_shared/domain.ts';
import { Icon } from '../components/Icon';
import { LocationPicker, placeOptions } from '../components/pickers';
import { CodeTag, Dialog, EmptyState, Field, Notice, PageHeader, StatusChip, Thumb } from '../components/ui';
import { createLocation, updateLocation } from '../lib/actions';
import { useFileSaver } from '../components/FileSaver';
import { blobFile } from '../lib/files';
import { useEstateData, useEstateId, useMe, useMyMembership } from '../lib/hooks';
import { itemLabelsPdf, placeLabelsPdf } from '../lib/pdf';
import { qrPath } from '../lib/qr';

function Qr({ text, size = 140 }: { text: string; size?: number }) {
  const { size: n, d } = qrPath(text);
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} width={size} height={size} role="img" aria-label={`QR code for ${text}`} className="rounded-lg bg-white">
      <path d={d} fill="#000" />
    </svg>
  );
}

const KINDS: LocationKind[] = ['AREA', 'CONTAINER', 'STAGING', 'HOLDING', 'PROPERTY', 'EXTERNAL'];

export function PlaceList() {
  const estateId = useEstateId();
  const saver = useFileSaver();
  const data = useEstateData(estateId);
  const me = useMe();
  const member = useMyMembership(data, me);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind>('STAGING');
  const [parent, setParent] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const options = useMemo(() => (data ? placeOptions(data.locations, (l) => l.kind !== 'PERSON') : []), [data]);
  if (!data) return null;

  async function add() {
    await createLocation(estateId, { name, kind, parentId: parent, purpose: purpose || null });
    setAdding(false);
    setName('');
    setPurpose('');
  }
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const print = () => {
    const places = data.locations.filter((l) => selected.has(l.id));
    void saver.deliver(blobFile(placeLabelsPdf(places, data.locations), 'place-labels.pdf', 'application/pdf'));
  };

  return (
    <div>
      <PageHeader title="Places and labels" back={`/e/${estateId}/more`} />
      <Notice tone="neutral" icon="box">
        Rooms, boxes and staging areas each have a scannable code. Print labels, stick them up, then use <Link to={`/e/${estateId}/scan`} className="font-bold underline">Batch inventory</Link> to scan items into a box or staging area with no typing.
      </Notice>
      {member?.can_add_items && (
        <button type="button" className="btn btn-primary btn-block mb-5" onClick={() => setAdding(true)}><Icon name="plus" /> Add a room, box or staging area</button>
      )}
      <ul className="divide-y divide-line border-y border-line">
        {options.map(({ loc, depth }) => (
          <li key={loc.id} className="flex items-center gap-3 py-2.5" style={{ paddingLeft: depth * 16 }}>
            <input type="checkbox" className="h-6 w-6" checked={selected.has(loc.id)} onChange={() => toggle(loc.id)} aria-label={`Select ${loc.name} for labels`} />
            <Link to={`/e/${estateId}/places/${loc.id}`} className="min-w-0 flex-1">
              <span className="block font-bold">{loc.name} <span className="font-normal text-ink-soft">({loc.tag})</span></span>
              <span className="text-[0.88rem] text-ink-soft">{LOCATION_KIND_LABELS[loc.kind]}{loc.purpose ? `. ${loc.purpose}` : ''}. {itemsIn(loc.id, data).length} items</span>
            </Link>
            <span className="hidden sm:block"><CodeTag code={loc.code} /></span>
          </li>
        ))}
      </ul>
      <div className="sticky bottom-20 mt-4">
        <button type="button" className="btn btn-primary btn-block" disabled={!selected.size} onClick={print}>
          <Icon name="tag" /> Print labels for {selected.size || 'selected'} place{selected.size === 1 ? '' : 's'}
        </button>
        {saver.panel}
      </div>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add a place">
        <Field label="Name" htmlFor="pl-name"><input id="pl-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Donate pile, Box 12, Kevin's pile" /></Field>
        <Field label="Kind of place" htmlFor="pl-kind">
          <select id="pl-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{LOCATION_KIND_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Inside" htmlFor="pl-parent"><LocationPicker id="pl-parent" data={data} value={parent} onChange={setParent} allowNone noneLabel="Not inside anything" allowCreate={false} /></Field>
        <Field label="Purpose (optional)" htmlFor="pl-purpose" hint="Shown on the label, e.g. “Items approved for donation”."><input id="pl-purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
        <button type="button" className="btn btn-primary btn-block" disabled={!name.trim()} onClick={() => void add()}>Add place</button>
      </Dialog>
    </div>
  );
}

export function PlaceDetail() {
  const estateId = useEstateId();
  const saver = useFileSaver();
  const { locationId } = useParams();
  const data = useEstateData(estateId);
  const me = useMe();
  const member = useMyMembership(data, me);
  const [editing, setEditing] = useState(false);
  const loc = data?.locations.find((l) => l.id === locationId);
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [purpose, setPurpose] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  if (!data) return null;
  if (!loc) return <EmptyState icon="map" title="Place not found" />;
  const locs = byId(data.locations);
  const items = itemsIn(loc.id, data);
  const redacted = new Set(data.redactions.map((r) => r.media_id));

  function startEdit() {
    setName(loc!.name); setTag(loc!.tag); setPurpose(loc!.purpose ?? ''); setParent(loc!.parent_id); setEditing(true);
  }
  async function save() {
    const changes: Record<string, unknown> = {};
    if (name !== loc!.name) changes.name = name;
    if (tag.toUpperCase() !== loc!.tag && /^[A-Z0-9]{2}$/i.test(tag)) changes.tag = tag.toUpperCase();
    if ((purpose || null) !== loc!.purpose) changes.purpose = purpose || null;
    if (parent !== loc!.parent_id && parent !== loc!.id) changes.parent_id = parent;
    if (Object.keys(changes).length) await updateLocation(loc!, changes);
    setEditing(false);
  }

  return (
    <div>
      <PageHeader title={loc.name} back={`/e/${estateId}/places`} />
      <div className="mb-6 flex items-center gap-4">
        <Qr text={loc.code} />
        <div>
          <CodeTag code={loc.code} large />
          <p className="mt-2 text-ink-soft">{LOCATION_KIND_LABELS[loc.kind]}. Room tag in item codes: <b>{loc.tag}</b>.</p>
          {loc.parent_id && <p className="text-ink-soft">Inside {locationPath(loc.parent_id, locs)}</p>}
          {loc.purpose && <p>{loc.purpose}</p>}
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => void saver.deliver(blobFile(placeLabelsPdf([loc], data.locations), `label-${loc.code}.pdf`, 'application/pdf'))}><Icon name="tag" /> Print label</button>
        {items.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => void saver.deliver(blobFile(itemLabelsPdf(items, data.locations), `item-labels-${loc.code}.pdf`, 'application/pdf'))}><Icon name="tag" /> Labels for items</button>}
        {member?.can_edit_items && <button type="button" className="btn btn-secondary" onClick={startEdit}><Icon name="pencil" /> Edit or move</button>}
      </div>
      {saver.panel}
      <h2 className="mb-2">{items.length} item{items.length === 1 ? '' : 's'} here</h2>
      <ul className="divide-y divide-line border-y border-line">
        {items.map((i) => (
          <li key={i.id}>
            <Link to={`/e/${estateId}/items/${i.id}`} className="flex items-center gap-3 py-2.5">
              <Thumb media={data.media.find((m) => m.item_id === i.id && !redacted.has(m.id))} size={52} />
              <span className="min-w-0 flex-1"><b>#{i.inventory_number}</b> {i.title}</span>
              <StatusChip status={i.status} />
            </Link>
          </li>
        ))}
      </ul>
      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit place">
        <Field label="Name" htmlFor="pe-name"><input id="pe-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Room tag (2 letters or digits)" htmlFor="pe-tag" hint="Used in codes of items found here from now on. Existing codes do not change.">
          <input id="pe-tag" className="input code uppercase" maxLength={2} value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Inside" htmlFor="pe-parent" hint="Moving a box moves everything in it.">
          <LocationPicker id="pe-parent" data={data} value={parent} onChange={setParent} allowNone noneLabel="Not inside anything" allowCreate={false} />
        </Field>
        <Field label="Purpose" htmlFor="pe-purpose"><input id="pe-purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
        <button type="button" className="btn btn-primary btn-block mb-3" onClick={() => void save()}>Save</button>
        {items.length === 0 && loc.kind !== 'PROPERTY' && (
          <button type="button" className="btn btn-quiet btn-block" onClick={() => { void updateLocation(loc, { archived: true }); setEditing(false); }}>Retire this place (it stays in the history)</button>
        )}
      </Dialog>
    </div>
  );
}
