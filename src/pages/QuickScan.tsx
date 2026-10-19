import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { categoryLabel, classifyScan } from '../../supabase/functions/_shared/codes.ts';
import { byId, isLiveItem, locationPath, type Item, type MediaKind } from '../../supabase/functions/_shared/domain.ts';
import { useFileSaver } from '../components/FileSaver';
import { Icon } from '../components/Icon';
import { CategoryPicker, LocationPicker } from '../components/pickers';
import { Scanner } from '../components/Scanner';
import { ActionDialog, CodeTag, ErrorText, Field, Notice, PageHeader, Spinner } from '../components/ui';
import { captureItem, online, recordCustody, type CapturePhoto } from '../lib/actions';
import type { Detected } from '../lib/barcode';
import { db, getMeta, setMeta } from '../lib/db';
import { blobFile } from '../lib/files';
import { useBlobUrl, useEstateData, useEstateId, useMe, useMyMembership } from '../lib/hooks';
import { preparePhoto } from '../lib/images';

/**
 * Batch inventory: record many items at once.
 *
 * Build a running list by scanning product barcodes, typing names, or adding
 * photos (one item per photo, including photos taken earlier). Set what the
 * items have in common once (room found, where they are going, kind, brand,
 * condition), then save them all. Scanning an item label adds a "move" for
 * that existing item; scanning a place label sets where the batch is going.
 *
 * Works with no signal. The list is kept on the phone until it is saved, so
 * closing the app loses nothing.
 */

interface BatchPhoto { sha256: string; thumb_sha256: string; mime_type: string; width: number; height: number; byte_size: number; kind: MediaKind }

interface BatchRow {
  id: string;
  n: number;
  kind: 'new' | 'move';
  title: string;
  quantity: number;
  barcode: string | null;
  barcode_format: string | null;
  photos: BatchPhoto[];
  itemId?: string;
  note?: string;
  category?: string | null;
  brand?: string | null;
}

interface Batch {
  rows: BatchRow[];
  counter: number;
  foundIn: string | null;
  putIn: string | null;
  category: string;
  brand: string;
  condition: string;
  valuable: boolean;
  familyChoices?: boolean;
}

interface SaveResult { rowId: string; label: string; item?: Item; draft?: boolean; note?: string; error?: string }

const emptyBatch = (keep?: Partial<Batch>): Batch => ({
  rows: [], counter: 0, foundIn: keep?.foundIn ?? null, putIn: keep?.putIn ?? null, category: keep?.category ?? 'MSC',
  brand: keep?.brand ?? '', condition: keep?.condition ?? '', valuable: keep?.valuable ?? false, familyChoices: keep?.familyChoices ?? false,
});

function RowThumb({ photo }: { photo?: BatchPhoto }) {
  const url = useBlobUrl(photo?.thumb_sha256);
  if (url) return <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />;
  return <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-sunk text-ink-soft"><Icon name="box" size={22} /></span>;
}

export default function QuickScan() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const me = useMe();
  const member = useMyMembership(data, me);
  const key = `batch:${estateId}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [savedLocally, setSavedLocally] = useState(false);
  const persistQueue = useRef<Promise<void>>(Promise.resolve());
  const savingRef = useRef(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [scanning, setScanning] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState<{ value: string; format: string; match: Item } | null>(null);
  const [results, setResults] = useState<SaveResult[] | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const rowPhotoRef = useRef<HTMLInputElement>(null);
  const rowTarget = useRef<string | null>(null);
  const saver = useFileSaver();

  // Restore an unsaved batch; keep it on the phone as it changes.
  useEffect(() => {
    let cancelled = false;
    setLoadedKey(null);
    void getMeta<Batch | null>(key, null).then((b) => {
      if (!cancelled) { setBatch(b ?? emptyBatch()); setLoadedKey(key); }
    }).catch(() => { if (!cancelled) setError('The saved batch could not be opened. Reload before capturing more items.'); });
    return () => { cancelled = true; };
  }, [key]);
  useEffect(() => {
    if (!batch || loadedKey !== key) return;
    let current = true;
    setSavedLocally(false);
    persistQueue.current = persistQueue.current.catch(() => undefined).then(() => setMeta(key, batch));
    void persistQueue.current.then(() => { if (current) setSavedLocally(true); }).catch(() => {
      if (current) setError('This device could not save the batch. Keep this screen open and free some storage.');
    });
    return () => { current = false; };
  }, [batch, key, loadedKey]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (busy || !savedLocally) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, savedLocally]);

  if (error && (!batch || loadedKey !== key)) return <ErrorText error={error} />;
  if (!data || !batch || loadedKey !== key) return <Spinner label="Opening your batch" />;
  if (member && !member.can_add_items) return <Notice tone="neutral" icon="lock">Your role does not allow adding inventory. Ask an administrator in Family and settings.</Notice>;
  const locs = byId(data.locations);
  const target = batch.putIn ?? data.estate?.default_location_id ?? null;
  const set = (patch: Partial<Batch>) => setBatch((b) => (b ? { ...b, ...patch } : b));
  const say = (text: string) => { setFlash(text); window.setTimeout(() => setFlash((f) => (f === text ? null : f)), 3500); };

  function addRow(row: Omit<BatchRow, 'id' | 'n'>) {
    setBatch((b) => {
      if (!b) return b;
      const n = b.counter + 1;
      return { ...b, counter: n, rows: [{ ...row, id: crypto.randomUUID(), n }, ...b.rows] };
    });
  }
  const updateRow = (id: string, patch: Partial<BatchRow>) =>
    setBatch((b) => (b ? { ...b, rows: b.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : b));
  const removeRow = (id: string) => setBatch((b) => (b ? { ...b, rows: b.rows.filter((r) => r.id !== id) } : b));

  async function storePhotos(files: FileList | File[]): Promise<BatchPhoto[]> {
    const out: BatchPhoto[] = [];
    for (const file of Array.from(files)) {
      const p = await preparePhoto(file);
      const t = new Date().toISOString();
      await db.blobs.bulkPut([
        { sha256: p.sha256, estate_id: estateId, blob: p.full, mime_type: p.mime_type, role: 'full', uploaded: false, created_at: t },
        { sha256: p.thumb_sha256, estate_id: estateId, blob: p.thumb, mime_type: 'image/jpeg', role: 'thumb', uploaded: false, created_at: t },
      ]);
      out.push({ sha256: p.sha256, thumb_sha256: p.thumb_sha256, mime_type: p.mime_type, width: p.width, height: p.height, byte_size: p.byte_size, kind: 'FULL_ITEM' });
    }
    return out;
  }

  // One new item per photo.
  async function photosAsItems(files: FileList | null) {
    if (!files?.length) return;
    setBusy('Preparing photos');
    setError(null);
    try {
      let added = 0;
      for (const file of Array.from(files)) {
        setBusy(`Preparing photo ${added + 1} of ${files.length}`);
        const p = (await storePhotos([file]))[0];
        addRow({ kind: 'new', title: '', quantity: 1, barcode: null, barcode_format: null, photos: [p] });
        added++;
      }
      say(`Added ${added} ${added === 1 ? 'item' : 'items'} from photos. Name them below, or save and name them later.`);
    } catch (e) {
      setError((e as Error).message || 'A photo could not be used.');
    } finally {
      setBusy(null);
    }
  }

  // More photos for one row (another angle, a marking, the box).
  async function photosForRow(files: FileList | null) {
    const id = rowTarget.current;
    if (!files?.length || !id) return;
    setBusy('Preparing photos');
    try {
      const photos = await storePhotos(files);
      setBatch((b) => (b ? { ...b, rows: b.rows.map((r) => (r.id === id ? { ...r, photos: [...r.photos, ...photos.map((p, i) => ({ ...p, kind: (r.photos.length + i === 0 ? 'FULL_ITEM' : 'OTHER') as MediaKind }))] } : r)) } : b));
    } catch (e) {
      setError((e as Error).message || 'A photo could not be used.');
    } finally {
      setBusy(null);
    }
  }

  function addByName(e: FormEvent) {
    e.preventDefault();
    const title = name.trim();
    if (!title) return;
    addRow({ kind: 'new', title, quantity: 1, barcode: null, barcode_format: null, photos: [] });
    setName('');
  }

  function addBarcode(value: string, format: string) {
    const inList = batch!.rows.find((r) => r.barcode === value);
    const id = crypto.randomUUID();
    setBatch((b) => {
      if (!b) return b;
      const n = b.counter + 1;
      return { ...b, counter: n, rows: [{ id, n, kind: 'new', title: '', quantity: 1, barcode: value, barcode_format: format, photos: [], note: inList ? `Same barcode as #${inList.n} in this batch` : undefined }, ...b.rows] };
    });
    say(`Added barcode ${value}`);
    if (navigator.onLine && /^\d{8,14}$/.test(value)) {
      online.barcodeLookup(value).then((r) => {
        if (r.found && r.title) {
          setBatch((b) => (b ? { ...b, rows: b.rows.map((x) => (x.id === id && !x.title ? { ...x, title: r.title!, brand: x.brand ?? r.brand ?? null } : x)) } : b));
        }
      }).catch(() => undefined);
    }
  }

  function onDetect(d: Detected) {
    const scan = classifyScan(d.value);
    if (scan.type === 'location') {
      const loc = data!.locations.find((l) => l.code === scan.code);
      if (!loc) return say(`Place ${scan.code} is not in this estate.`);
      set({ putIn: loc.id });
      return say(`This batch is going to ${loc.name}`);
    }
    if (scan.type === 'item') {
      const item = data!.items.find((i) => i.item_code === scan.code);
      if (!item) return say(`Item ${scan.code} is not in this estate (or not synced yet).`);
      if (batch!.rows.some((r) => r.itemId === item.id)) return say(`#${item.inventory_number} is already in this batch.`);
      addRow({ kind: 'move', title: item.title, quantity: item.quantity, barcode: null, barcode_format: null, photos: [], itemId: item.id, note: `Already recorded as #${item.inventory_number}. It will be moved with this batch.` });
      return say(`#${item.inventory_number} ${item.title} will move with this batch`);
    }
    const match = data!.items.find((i) => isLiveItem(i) && i.barcode === scan.value);
    if (match && !batch!.rows.some((r) => r.barcode === scan.value)) {
      setPending({ value: scan.value, format: d.format, match });
      return;
    }
    addBarcode(scan.value, d.format);
  }

  async function photosFor(row: BatchRow): Promise<CapturePhoto[]> {
    const out: CapturePhoto[] = [];
    for (const p of row.photos) {
      const [full, thumb] = await Promise.all([db.blobs.get(p.sha256), db.blobs.get(p.thumb_sha256)]);
      if (!full || !thumb) throw new Error('A photo is missing from this device. Add it again before saving this item.');
      out.push({ ...p, full: full.blob, thumb: thumb.blob });
    }
    return out;
  }

  async function saveAll() {
    if (savingRef.current) return;
    if (batch!.familyChoices && !member?.can_propose) { setError('Turn off family choices or ask an administrator for permission to propose.'); return; }
    const rows = [...batch!.rows].reverse(); // save in the order they were added
    if (!rows.length) return;
    savingRef.current = true;
    setError(null);
    const out: SaveResult[] = [];
    for (const [i, r] of rows.entries()) {
      setBusy(`Saving ${i + 1} of ${rows.length}`);
      try {
        if (r.kind === 'move') {
          const item = data!.items.find((x) => x.id === r.itemId);
          if (!item) throw new Error('This item is no longer on this phone.');
          if (!target || item.current_location_id === target) out.push({ rowId: r.id, label: `#${item.inventory_number} ${item.title}`, item, note: 'Already there' });
          else if (item.do_not_move) out.push({ rowId: r.id, label: `#${item.inventory_number} ${item.title}`, item, note: 'Held in place, not moved' });
          else {
            await recordCustody(item, { event_type: 'MOVED', to_location_id: target, purpose: 'Batch inventory' });
            out.push({ rowId: r.id, label: `#${item.inventory_number} ${item.title}`, item, note: `Moved to ${locationPath(target, locs)}` });
          }
          continue;
        }
        const named = r.title.trim();
        const title = named || (r.barcode ? `Item with barcode ${r.barcode}` : 'Unnamed item (see photo)');
        const res = await captureItem({
          captureKey: r.id, estateId, title, category: r.category || batch!.category, quantity: r.quantity, foundLocationId: batch!.foundIn,
          locationId: target, status: named ? 'DISCOVERED' : 'NEEDS_IDENTIFICATION', brand: (r.brand ?? batch!.brand) || null,
          condition: batch!.condition || null, potentially_valuable: batch!.valuable, barcode: r.barcode,
          barcode_format: r.barcode_format, photos: await photosFor(r), duplicateChecks: [], nextStep: { type: batch!.familyChoices ? 'grab' : 'review' },
        });
        out.push(res.kind === 'item' ? { rowId: r.id, label: `#${res.item.inventory_number} ${res.item.title}`, item: res.item } : { rowId: r.id, label: title, draft: true });
      } catch (e) {
        out.push({ rowId: r.id, label: r.title || r.barcode || `Row ${r.n}`, error: (e as Error).message });
      }
    }
    // Keep only rows that failed, so nothing is lost.
    const failed = new Set(out.filter((o) => o.error).map((o) => o.rowId));
    setBatch((b) => (b ? { ...b, rows: b.rows.filter((r) => failed.has(r.id)) } : b));
    setResults(out);
    savingRef.current = false;
    setBusy(null);
    window.scrollTo(0, 0);
  }

  async function printLabels() {
    const items = (results ?? []).filter((r) => r.item && !r.note).map((r) => r.item!);
    if (!items.length) return;
    const { itemLabelsPdf } = await import('../lib/pdf');
    await saver.deliver(blobFile(itemLabelsPdf(items, data!.locations), `batch-labels-${new Date().toISOString().slice(0, 10)}.pdf`, 'application/pdf'));
  }

  const newCount = batch.rows.filter((r) => r.kind === 'new').length;
  const moveCount = batch.rows.length - newCount;

  return (
    <div>
      <PageHeader title="Batch inventory" back={`/e/${estateId}`} />

      {results && (
        <section className="panel mb-6 p-4" aria-labelledby="saved-h">
          <h2 id="saved-h" className="mb-2">Saved {results.filter((r) => !r.error).length} of {results.length}</h2>
          <ul className="mb-3 divide-y divide-line">
            {results.map((r) => (
              <li key={r.rowId} className="flex flex-wrap items-center gap-2 py-2">
                {r.item && !r.note && <CodeTag code={r.item.item_code} />}
                <span className="flex-1">{r.label}{r.note && <span className="text-ink-soft">: {r.note}</span>}{r.draft && <span className="text-ink-soft">: saved on this phone, numbered when you have signal</span>}</span>
                {r.error && <span className="font-bold text-[var(--warning-ink)]">Not saved: {r.error}</span>}
                {r.item && <Link to={`/e/${estateId}/items/${r.item.id}`} className="font-bold text-action">Open</Link>}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => void printLabels()} disabled={!results.some((r) => r.item && !r.note)}><Icon name="tag" size={18} /> Labels for these</button>
            <button type="button" className="btn btn-secondary" onClick={() => setResults(null)}><Icon name="plus" size={18} /> Next batch</button>
          </div>
          <Link className="btn btn-primary btn-block mt-3" to={`/e/${estateId}/items?filter=info`}>Review unnamed items later</Link>
          {saver.panel}
        </section>
      )}

      <Notice tone="neutral" icon="scan">
        Photograph first, identify later. One photo creates one item; a whole-room photo does not identify separate objects. Record many items at once. Add them to the list below by <b>scanning barcodes</b>, <b>typing names</b>, or <b>adding photos</b> (one item per photo, including ones taken earlier). Set what they have in common once, then save them all. Works with no signal.
      </Notice>

      <fieldset disabled={!!busy} className="contents">
      <section className="panel mb-5 p-4" aria-labelledby="common-h">
        <h2 id="common-h" className="mb-3">Start with one room</h2>
        <Field label="Found in (the room)" htmlFor="b-found" hint="Becomes part of each item's code.">
          <LocationPicker id="b-found" data={data} value={batch.foundIn} onChange={(v) => set({ foundIn: v })} allowNone kinds={['PROPERTY', 'AREA', 'CONTAINER']} />
        </Field>
        <details className="mb-3"><summary className="cursor-pointer py-2 font-bold text-action">Shared details and family choices (optional)</summary>
        <Field label="Going to" htmlFor="b-put" hint="A box, staging area or the holding area. Scanning a place label sets this too.">
          <LocationPicker id="b-put" data={data} value={target} onChange={(v) => set({ putIn: v })} kinds={['PROPERTY', 'AREA', 'CONTAINER', 'STAGING', 'HOLDING']} createKind="CONTAINER" />
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Kind of item" htmlFor="b-cat"><CategoryPicker id="b-cat" value={batch.category} onChange={(v) => set({ category: v })} /></Field>
          <Field label="Brand or maker (optional)" htmlFor="b-brand"><input id="b-brand" className="input" value={batch.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="e.g. Lenox" /></Field>
        </div>
        <Field label="Condition (optional)" htmlFor="b-cond"><input id="b-cond" className="input" value={batch.condition} onChange={(e) => set({ condition: e.target.value })} placeholder="e.g. Good, some chips" /></Field>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-6 w-6" checked={batch.valuable} onChange={(e) => set({ valuable: e.target.checked })} />
          <span><b>All might be valuable or collectible</b></span>
        </label>
        <label className="mt-4 flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-6 w-6" checked={!!batch.familyChoices} disabled={!member?.can_propose && !batch.familyChoices} onChange={(e) => set({ familyChoices: e.target.checked })} />
          <span><b>Ask the family about these items</b><span className="block text-ink-soft">Each person can choose: I want it, Not for me, or Discuss first. Your estate's open or sealed choice rules apply. This does not assign ownership.</span></span>
        </label>
        </details>
      </section>

      <section className="mb-5" aria-label="Add to the batch">
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <button type="button" className="btn btn-primary min-h-16" onClick={() => cameraRef.current?.click()}><Icon name="camera" size={26} /> Photograph an item</button>
          <button type="button" className="btn btn-secondary" onClick={() => libraryRef.current?.click()}><Icon name="copy" size={22} /> Import many photos</button>
        </div>
        {!scanning ? (
          <button type="button" className="btn btn-secondary btn-block mb-3" onClick={() => setScanning(true)}>
            <Icon name="scan" size={26} /> Scan barcodes and labels
          </button>
        ) : (
          <div className="mb-3">
            <Scanner continuous onDetect={onDetect} hint={`Going to: ${locationPath(target, locs)}`} />
            <button type="button" className="btn btn-secondary btn-block mt-3" onClick={() => setScanning(false)}>Stop scanning</button>
          </div>
        )}
        {flash && <p className="mb-3 font-bold" role="status">{flash}</p>}
        <form className="mb-3 flex gap-2" onSubmit={addByName}>
          <label htmlFor="b-name" className="sr-only">Item name</label>
          <input id="b-name" className="input flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type a name, e.g. Dinner plate" />
          <button className="btn btn-secondary px-4"><Icon name="plus" size={18} /> Add</button>
        </form>
<p className="mb-3 text-[0.9rem] text-ink-soft">Take another photo to keep going. Add extra angles using Photo on an existing row.</p>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="sr-only" aria-label="Take photos, one item per photo" onChange={(e) => { void photosAsItems(e.target.files); e.target.value = ''; }} />
        <input ref={libraryRef} type="file" accept="image/*" multiple className="sr-only" aria-label="Choose photos, one item per photo" onChange={(e) => { void photosAsItems(e.target.files); e.target.value = ''; }} />
        <input ref={rowPhotoRef} type="file" accept="image/*" multiple className="sr-only" aria-label="Add photos to this item" onChange={(e) => { void photosForRow(e.target.files); e.target.value = ''; }} />
      </section>

      {pending && (
        <div className="panel mb-5 p-4" role="alertdialog" aria-labelledby="b-dup">
          <h2 id="b-dup" className="mb-2">This barcode is already recorded</h2>
          <p className="mb-3">#{pending.match.inventory_number} {pending.match.title}, in {locationPath(pending.match.current_location_id, locs)}.</p>
          <div className="grid gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => { const m = pending.match; setPending(null); onDetect({ value: m.item_code, format: 'qr_code' }); }}>Same item: move it with this batch</button>
            <button type="button" className="btn btn-primary" onClick={() => { const p = pending; setPending(null); addBarcode(p.value, p.format); }}>Another one: add it as a new item</button>
          </div>
        </div>
      )}

      {busy && <p className="mb-4"><Spinner label={busy} /></p>}
      <ErrorText error={error} />

      <section aria-labelledby="list-h">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="list-h">In this batch ({batch.rows.length})</h2>
          {batch.rows.length > 0 && (
            <button type="button" className="btn btn-quiet min-h-10" onClick={() => setConfirmClear(true)}>Clear</button>
          )}
          <ActionDialog
            open={confirmClear}
            onClose={() => setConfirmClear(false)}
            title="Clear this batch?"
            confirmLabel="Clear list"
            danger
            onConfirm={() => set({ rows: [] })}
          >
            Items in this list have not been saved.
          </ActionDialog>
        </div>
        {batch.rows.length === 0 ? (
          <p className="mb-6 text-ink-soft">Nothing yet. Scan, type or add photos above; each one appears here.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {batch.rows.map((r) => (
              <li key={r.id} className="panel p-3">
                <div className="flex items-start gap-3">
                  {r.kind === 'move' ? (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-sunk text-action"><Icon name="map" size={22} /></span>
                  ) : (
                    <RowThumb photo={r.photos[0]} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="tabular text-[0.85rem] text-ink-soft">{r.n}.</span>
                      {r.kind === 'move' ? (
                        <b className="truncate">{r.title}</b>
                      ) : (
                        <input aria-label={`Name for item ${r.n}`} className="input min-h-10 flex-1 py-1" value={r.title} placeholder={r.barcode ? `Item with barcode ${r.barcode}` : 'Name this item'} onChange={(e) => updateRow(r.id, { title: e.target.value })} />
                      )}
                    </div>
                    <p className="mt-1 text-[0.85rem] text-ink-soft">
                      {r.barcode && <>Barcode <code>{r.barcode}</code>. </>}
                      {r.photos.length > 0 && <>{r.photos.length} {r.photos.length === 1 ? 'photo' : 'photos'}. </>}
                      {r.kind === 'new' && (r.category || r.brand) && <>{r.category ? categoryLabel(r.category) : ''}{r.category && r.brand ? ', ' : ''}{r.brand ?? ''}. </>}
                      {r.note}
                    </p>
                  </div>
                  <button type="button" className="btn btn-quiet min-h-10 px-2" aria-label={`Remove item ${r.n} from the batch`} onClick={() => removeRow(r.id)}><Icon name="x" size={18} /></button>
                </div>
                {r.kind === 'new' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-[0.9rem]">How many
                      <input type="number" min={1} inputMode="numeric" className="input tabular min-h-10 w-20 py-1" value={r.quantity} onChange={(e) => updateRow(r.id, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
                    </label>
                    <button type="button" className="btn btn-quiet min-h-10 px-2" onClick={() => { rowTarget.current = r.id; rowPhotoRef.current?.click(); }}><Icon name="camera" size={16} /> Photo</button>
                    <button type="button" className="btn btn-quiet min-h-10 px-2" aria-expanded={openRow === r.id} onClick={() => setOpenRow(openRow === r.id ? null : r.id)}><Icon name="pencil" size={16} /> Different kind or brand</button>
                  </div>
                )}
                {openRow === r.id && r.kind === 'new' && (
                  <div className="mt-3 grid gap-x-3 sm:grid-cols-2">
                    <Field label="Kind of item" htmlFor={`k-${r.id}`}><CategoryPicker id={`k-${r.id}`} value={r.category ?? batch.category} onChange={(v) => updateRow(r.id, { category: v })} /></Field>
                    <Field label="Brand or maker" htmlFor={`br-${r.id}`}><input id={`br-${r.id}`} className="input" value={r.brand ?? ''} placeholder={batch.brand || 'Same as the batch'} onChange={(e) => updateRow(r.id, { brand: e.target.value || null })} /></Field>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      </fieldset>
      <p className="mb-3 text-ink-soft" role="status">{savedLocally ? "Batch saved on this device. Save the items below to add them to the shared inventory." : "Saving this batch on this device…"}</p>
      {batch.rows.length > 0 && (
        <div className="sticky bottom-24 z-10 pb-2">
          <button type="button" className="btn btn-primary btn-block min-h-16 text-lg shadow-lg" disabled={!!busy || !savedLocally} onClick={() => void saveAll()}>
            <Icon name="check" size={24} /> Save {newCount ? `${newCount} new ${newCount === 1 ? 'item' : 'items'}` : ''}{newCount && moveCount ? ' and ' : ''}{moveCount ? `${moveCount} ${moveCount === 1 ? 'move' : 'moves'}` : ''}
          </button>
          <p className="mt-1 text-center text-[0.85rem] text-ink-soft">Unnamed items are saved as “needs identifying”. Possible duplicates show up in the Exceptions report.</p>
        </div>
      )}
    </div>
  );
}

