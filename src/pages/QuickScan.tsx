import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { classifyScan, categoryLabel } from '../../supabase/functions/_shared/codes.ts';
import { byId, isLiveItem, locationPath, type Item } from '../../supabase/functions/_shared/domain.ts';
import { Icon } from '../components/Icon';
import { CategoryPicker, LocationPicker } from '../components/pickers';
import { Scanner } from '../components/Scanner';
import { CodeTag, Field, Notice, PageHeader } from '../components/ui';
import { addPhotos, captureItem, recordCustody, updateItem } from '../lib/actions';
import { useEstateData, useEstateId } from '../lib/hooks';
import { preparePhoto } from '../lib/images';
import type { Detected } from '../lib/barcode';

interface LogEntry { id: string; text: string; tone: 'done' | 'progress' | 'attention' | 'warning'; itemId?: string; code?: string }

/**
 * Scan and put away. Built for closets and basements with no signal:
 *  - scan a place label (BOX-9Q4TR) to choose where items go,
 *  - scan an item label to move that item there,
 *  - scan a product barcode to record a new item there in one step.
 */
export default function QuickScan() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const [foundIn, setFoundIn] = useState<string | null>(null);
  const [putIn, setPutIn] = useState<string | null>(null);
  const [category, setCategory] = useState('MSC');
  const [scanning, setScanning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pendingBarcode, setPendingBarcode] = useState<{ value: string; format: string; match: Item } | null>(null);
  const [lastItem, setLastItem] = useState<Item | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  if (!data) return null;
  const locs = byId(data.locations);
  const target = putIn ?? data.estate?.default_location_id ?? null;
  const add = (e: Omit<LogEntry, 'id'>) => setLog((l) => [{ ...e, id: crypto.randomUUID() }, ...l].slice(0, 50));

  async function newItemFromBarcode(value: string, format: string) {
    const result = await captureItem({
      estateId, title: `Item with barcode ${value}`, category, quantity: 1, foundLocationId: foundIn, locationId: target,
      status: 'NEEDS_IDENTIFICATION', barcode: value, barcode_format: format, photos: [], duplicateChecks: [], nextStep: { type: 'review' },
    });
    if (result.kind === 'item') {
      setLastItem(result.item);
      add({ text: `Recorded #${result.item.inventory_number} in ${locationPath(target, locs)}`, tone: 'done', itemId: result.item.id, code: result.item.item_code });
    } else {
      add({ text: 'Saved on this phone; it will be numbered when you have signal.', tone: 'attention' });
    }
  }

  async function onDetect(d: Detected) {
    const scan = classifyScan(d.value);
    if (scan.type === 'location') {
      const loc = data!.locations.find((l) => l.code === scan.code);
      if (!loc) return add({ text: `Place ${scan.code} is not in this estate.`, tone: 'warning' });
      setPutIn(loc.id);
      return add({ text: `Now putting items in ${loc.name}`, tone: 'progress' });
    }
    if (scan.type === 'item') {
      const item = data!.items.find((i) => i.item_code === scan.code);
      if (!item) return add({ text: `Item ${scan.code} is not in this estate (or not synced yet).`, tone: 'warning' });
      if (item.current_location_id === target) return add({ text: `#${item.inventory_number} is already in ${locationPath(target, locs)}`, tone: 'progress', itemId: item.id });
      if (item.do_not_move) return add({ text: `#${item.inventory_number} is marked “Hold in place” and was not moved.`, tone: 'warning', itemId: item.id });
      await recordCustody(item, { event_type: 'MOVED', to_location_id: target, purpose: 'Put away' });
      setLastItem(item);
      return add({ text: `Moved #${item.inventory_number} ${item.title} to ${locationPath(target, locs)}`, tone: 'done', itemId: item.id });
    }
    const match = data!.items.find((i) => isLiveItem(i) && i.barcode === scan.value);
    if (match) {
      setPendingBarcode({ value: scan.value, format: d.format, match });
      return;
    }
    await newItemFromBarcode(scan.value, d.format);
  }

  async function addPhotoToLast(files: FileList | null) {
    if (!files?.length || !lastItem) return;
    const photos = [];
    for (const f of Array.from(files)) photos.push({ ...(await preparePhoto(f)), kind: 'FULL_ITEM' as const });
    await addPhotos(lastItem, photos);
    add({ text: `Added ${photos.length} photo${photos.length > 1 ? 's' : ''} to #${lastItem.inventory_number}`, tone: 'done', itemId: lastItem.id });
  }

  return (
    <div>
      <PageHeader title="Scan and put away" back={`/e/${estateId}`} />
      <Notice tone="neutral" icon="scan">
        Scan a <b>place label</b> to choose where things go, an <b>item label</b> to move it there, or a <b>product barcode</b> to record a new item there. Works with no signal.
      </Notice>

      <Field label="Found in (the room)" htmlFor="qs-found" hint="Becomes part of each new item's code.">
        <LocationPicker id="qs-found" data={data} value={foundIn} onChange={setFoundIn} allowNone kinds={['PROPERTY', 'AREA', 'CONTAINER']} />
      </Field>
      <Field label="Putting items in" htmlFor="qs-put">
        <LocationPicker id="qs-put" data={data} value={target} onChange={setPutIn} kinds={['PROPERTY', 'AREA', 'CONTAINER', 'STAGING', 'HOLDING']} createKind="CONTAINER" />
      </Field>
      <Field label="Kind of items in this batch" htmlFor="qs-cat" hint={`New items are recorded as ${categoryLabel(category).toLowerCase()}. You can change each one later.`}>
        <CategoryPicker id="qs-cat" value={category} onChange={setCategory} />
      </Field>

      {!scanning ? (
        <button type="button" className="btn btn-primary btn-block mb-6 min-h-16 text-lg" onClick={() => setScanning(true)}>
          <Icon name="scan" size={26} /> Start scanning
        </button>
      ) : (
        <div className="mb-6">
          <Scanner continuous onDetect={(d) => void onDetect(d)} hint={`Putting items in: ${locationPath(target, locs)}`} />
          <button type="button" className="btn btn-secondary btn-block mt-3" onClick={() => setScanning(false)}>Stop scanning</button>
        </div>
      )}

      {pendingBarcode && (
        <div className="panel mb-6 p-4" role="alertdialog" aria-labelledby="dup-title">
          <h2 id="dup-title" className="mb-2">This barcode is already recorded</h2>
          <p className="mb-3">#{pendingBarcode.match.inventory_number} {pendingBarcode.match.title}, in {locationPath(pendingBarcode.match.current_location_id, locs)}.</p>
          <div className="grid gap-2">
            <button type="button" className="btn btn-secondary" onClick={async () => { const m = pendingBarcode.match; setPendingBarcode(null); await onDetect({ value: m.item_code, format: 'qr_code' }); }}>
              Same item: move it here
            </button>
            <button type="button" className="btn btn-secondary" onClick={async () => { const m = pendingBarcode.match; setPendingBarcode(null); await updateItem(m, { quantity: m.quantity + 1 }); add({ text: `#${m.inventory_number} quantity is now ${m.quantity + 1}`, tone: 'done', itemId: m.id }); }}>
              Another one: add to its quantity
            </button>
            <button type="button" className="btn btn-primary" onClick={async () => { const p = pendingBarcode; setPendingBarcode(null); await newItemFromBarcode(p.value, p.format); }}>
              Another one: record it separately
            </button>
          </div>
        </div>
      )}

      {lastItem && (
        <div className="mb-6 flex items-center gap-3">
          <CodeTag code={lastItem.item_code} />
          <button type="button" className="btn btn-quiet" onClick={() => photoRef.current?.click()}><Icon name="camera" size={18} /> Add a photo</button>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void addPhotoToLast(e.target.files); e.target.value = ''; }} />
        </div>
      )}

      {log.length > 0 && (
        <section aria-label="This session" aria-live="polite">
          <h2 className="mb-3">This session</h2>
          <ul className="divide-y divide-line border-y border-line">
            {log.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-3">
                <span className={`chip tone-${e.tone} px-1.5`}><Icon name={e.tone === 'warning' ? 'alert' : e.tone === 'done' ? 'check' : 'map'} size={16} /></span>
                <span className="flex-1">{e.text}</span>
                {e.itemId && <Link to={`/e/${estateId}/items/${e.itemId}`} className="font-bold text-action">Open</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
