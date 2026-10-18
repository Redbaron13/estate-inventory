import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  DUPLICATE_REASON_LABELS, MEDIA_KIND_LABELS, byId, findDuplicateCandidates, locationPath,
  type DuplicateCandidate, type Item, type MediaKind, type ProposalAction,
} from '../../supabase/functions/_shared/domain.ts';
import { Icon } from '../components/Icon';
import { CategoryPicker, LocationPicker, MemberPicker } from '../components/pickers';
import { Scanner } from '../components/Scanner';
import { ActionDialog, CodeTag, ErrorText, Field, Notice, PageHeader, Spinner, StatusChip, Thumb } from '../components/ui';
import { addPhotos, captureItem, online, updateItem, type CapturePhoto, type NextStep } from '../lib/actions';
import { db, getMeta, setMeta } from '../lib/db';
import { useBlobUrl, useEstateData, useEstateId, useMe, useMyMembership } from '../lib/hooks';
import { preparePhoto } from '../lib/images';
import { useFileSaver } from '../components/FileSaver';
import { blobFile } from '../lib/files';

type Step = 'capture' | 'scan' | 'details' | 'duplicates' | 'next' | 'saved';

interface WipPhoto { sha256: string; thumb_sha256: string; mime_type: string; width: number; height: number; byte_size: number; kind: MediaKind }

interface Wip {
  step: Step;
  photos: WipPhoto[];
  barcode: string;
  barcode_format: string;
  title: string;
  category: string;
  quantity: number;
  foundLocationId: string | null;
  locationId: string | null;
  description: string;
  condition: string;
  brand: string;
  model: string;
  serial_number: string;
  markings: string;
  notes: string;
  potentially_valuable: boolean;
  do_not_move: boolean;
  do_not_move_reason: string;
  checks: { other_item_id: string; verdict: 'DIFFERENT_ITEMS' | 'UNSURE'; reasons: DuplicateCandidate['reasons'] }[];
  next: NextStep['type'] | 'assign' | 'sell' | 'donate' | 'dispose';
  recipient: string | null;
  organization: string;
  amount: string;
  disposeAs: 'RECYCLE' | 'DISPOSE';
}

const blankWip = (ctx?: Partial<Wip>): Wip => ({
  step: 'capture', photos: [], barcode: '', barcode_format: '', title: '', category: ctx?.category ?? 'MSC', quantity: 1,
  foundLocationId: ctx?.foundLocationId ?? null, locationId: ctx?.locationId ?? null, description: '', condition: '',
  brand: '', model: '', serial_number: '', markings: '', notes: '', potentially_valuable: false, do_not_move: false,
  do_not_move_reason: '', checks: [], next: 'review', recipient: null, organization: '', amount: '', disposeAs: 'DISPOSE',
});

function PhotoPreview({ sha }: { sha: string }) {
  const url = useBlobUrl(sha);
  return url ? <img src={url} alt="" className="h-24 w-24 rounded-xl object-cover" /> : <div className="h-24 w-24 rounded-xl bg-sunk" />;
}

export default function Capture() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const me = useMe();
  const membership = useMyMembership(data, me);
  const navigate = useNavigate();
  const wipKey = `capture-wip:${estateId}`;
  const [wip, setWip] = useState<Wip | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ item?: Item; draft?: boolean } | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const savedHeadingRef = useRef<HTMLHeadingElement>(null);
  const captureButtonRef = useRef<HTMLButtonElement>(null);
  const previousStepRef = useRef<Step | null>(null);
  const step = wip?.step;
  const fileRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const saver = useFileSaver();
  const markRef = useRef<HTMLInputElement>(null);

  // Restore an unfinished capture: never discard a partially entered item.
  useEffect(() => {
    void (async () => {
      const existing = await getMeta<Wip | null>(wipKey, null);
      const ctx = await getMeta<Partial<Wip> | null>(`capture-context:${estateId}`, null);
      setWip(existing && existing.step !== 'saved' ? existing : blankWip(ctx ?? undefined));
    })();
  }, [wipKey, estateId]);

  useEffect(() => {
    if (wip && wip.step !== 'saved') void setMeta(wipKey, wip);
  }, [wip, wipKey]);
  useEffect(() => {
    if (!step) return;
    if (step === 'duplicates' || step === 'next' || step === 'scan') stepHeadingRef.current?.focus();
    else if (step === 'saved') savedHeadingRef.current?.focus();
    else if (previousStepRef.current === 'saved' && step === 'capture') captureButtonRef.current?.focus();
    previousStepRef.current = step;
  }, [step]);

  const candidates = useMemo(() => {
    if (!data || !wip) return [];
    return findDuplicateCandidates(
      { title: wip.title, barcode: wip.barcode || null, serial_number: wip.serial_number || null, found_location_id: wip.foundLocationId, photoHashes: wip.photos.map((p) => p.sha256) },
      data,
    );
  }, [data, wip]);

  if (!data || !wip) return null;
  if (membership && !membership.can_add_items) {
    return <Notice tone="neutral" icon="lock">Your role in this estate does not include adding items.</Notice>;
  }
  const estate = data.estate;
  const set = (patch: Partial<Wip>) => setWip((w) => (w ? { ...w, ...patch } : w));
  const go = (step: Step) => { setError(null); set({ step }); window.scrollTo(0, 0); };

  // kind: what the photos show; by default the first is the whole item.
  async function addFiles(files: FileList | null, kind?: MediaKind) {
    if (!files?.length) return;
    setBusy('Preparing photos…');
    try {
      const added: WipPhoto[] = [];
      for (const file of Array.from(files)) {
        const p = await preparePhoto(file);
        const t = new Date().toISOString();
        await db.blobs.bulkPut([
          { sha256: p.sha256, estate_id: estateId, blob: p.full, mime_type: p.mime_type, role: 'full', uploaded: false, created_at: t },
          { sha256: p.thumb_sha256, estate_id: estateId, blob: p.thumb, mime_type: 'image/jpeg', role: 'thumb', uploaded: false, created_at: t },
        ]);
        added.push({ sha256: p.sha256, thumb_sha256: p.thumb_sha256, mime_type: p.mime_type, width: p.width, height: p.height, byte_size: p.byte_size, kind: kind ?? (wip!.photos.length + added.length === 0 ? 'FULL_ITEM' : 'OTHER') });
      }
      set({ photos: [...wip!.photos, ...added] });
    } catch (e) {
      setError((e as Error).message || 'That photo could not be used.');
    } finally {
      setBusy(null);
    }
  }

  async function photosForSave(): Promise<CapturePhoto[]> {
    const out: CapturePhoto[] = [];
    for (const p of wip!.photos) {
      const [full, thumb] = await Promise.all([db.blobs.get(p.sha256), db.blobs.get(p.thumb_sha256)]);
      if (full && thumb) out.push({ ...p, full: full.blob, thumb: thumb.blob });
    }
    return out;
  }

  async function onBarcode(value: string, format: string) {
    set({ barcode: value, barcode_format: format, step: 'details' });
    if (navigator.onLine && /^\d{8,14}$/.test(value)) {
      try {
        const r = await online.barcodeLookup(value);
        if (r.found && r.title) setSuggestion(r.title);
      } catch {
        /* suggestion only */
      }
    }
  }

  function toNext() {
    if (!wip!.title.trim()) {
      setError('Add a short description (you can change it later).');
      return;
    }
    go(candidates.length && wip!.checks.length === 0 ? 'duplicates' : 'next');
  }

  async function sameItem(c: DuplicateCandidate, addQuantity: boolean) {
    setBusy('Saving…');
    try {
      const photos = await photosForSave();
      if (photos.length) await addPhotos(c.item, photos);
      if (addQuantity) await updateItem(c.item, { quantity: c.item.quantity + Math.max(1, wip!.quantity) });
      await setMeta(wipKey, null);
      navigate(`/e/${estateId}/items/${c.item.id}`);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('Saving…');
    setError(null);
    try {
      const w = wip!;
      let nextStep: NextStep = { type: 'review' };
      if (w.next === 'grab') nextStep = { type: 'grab' };
      else if (w.next === 'appraisal') nextStep = { type: 'appraisal' };
      else if (w.next === 'assign') {
        if (!w.recipient) throw new Error('Choose who should receive it.');
        nextStep = { type: 'proposal', action: 'ASSIGN', recipient_user_id: w.recipient };
      } else if (w.next === 'sell') nextStep = { type: 'proposal', action: 'SELL', organization: w.organization || null };
      else if (w.next === 'donate') nextStep = { type: 'proposal', action: 'DONATE', organization: w.organization || null };
      else if (w.next === 'dispose') nextStep = { type: 'proposal', action: w.disposeAs as ProposalAction };
      const result = await captureItem({
        estateId, title: w.title, category: w.category, quantity: w.quantity, foundLocationId: w.foundLocationId,
        locationId: w.locationId, description: w.description || null, condition: w.condition || null,
        barcode: w.barcode || null, barcode_format: w.barcode_format || null, brand: w.brand || null, model: w.model || null,
        serial_number: w.serial_number || null, markings: w.markings || null, notes: w.notes || null, potentially_valuable: w.potentially_valuable,
        do_not_move: w.do_not_move, do_not_move_reason: w.do_not_move_reason || null,
        photos: await photosForSave(), duplicateChecks: w.checks, nextStep,
      });
      await setMeta(`capture-context:${estateId}`, { category: w.category, foundLocationId: w.foundLocationId, locationId: w.locationId });
      await setMeta(wipKey, null);
      setSaved(result.kind === 'item' ? { item: result.item } : { draft: true });
      set({ step: 'saved' });
      window.scrollTo(0, 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function printLabel(item: Item) {
    const { itemLabelsPdf } = await import('../lib/pdf');
    const pdf = itemLabelsPdf([item], data!.locations);
    await saver.deliver(blobFile(pdf, `label-${item.item_code}.pdf`, 'application/pdf'));
  }

  function another() {
    setSaved(null);
    setSuggestion(null);
    setWip(blankWip({ category: wip!.category, foundLocationId: wip!.foundLocationId, locationId: wip!.locationId }));
  }

  async function discard() {
    await db.blobs.bulkDelete(wip!.photos.flatMap((p) => [p.sha256, p.thumb_sha256]));
    await setMeta(wipKey, null);
    setWip(blankWip({ category: wip!.category, foundLocationId: wip!.foundLocationId, locationId: wip!.locationId }));
    setConfirmDiscard(false);
  }

  const locs = byId(data.locations);

  // ------------------------------------------------------------------ saved
  if (wip.step === 'saved' && saved) {
    return (
      <div className="pt-6 text-center">
        {saved.item ? (
          <>
            <div className="mb-6"><CodeTag code={saved.item.item_code} large swing /></div>
            <h1 ref={savedHeadingRef} tabIndex={-1} className="mb-2">Saved. Item {String(saved.item.inventory_number).padStart(4, '0')} is in the inventory.</h1>
            <p className="mb-8 text-ink-soft">You can add more information later.{!navigator.onLine && ' It will upload when you have signal.'}</p>
            <div className="grid gap-3">
              <button type="button" className="btn btn-primary btn-block" onClick={another}><Icon name="camera" /> Add another item</button>
              <Link to={`/e/${estateId}/items/${saved.item.id}`} className="btn btn-secondary btn-block">View this item</Link>
              <button type="button" className="btn btn-quiet" onClick={() => void printLabel(saved.item!)}><Icon name="tag" size={18} /> Print a label for it</button>
              {saver.panel}
            </div>
          </>
        ) : (
          <>
            <h1 ref={savedHeadingRef} tabIndex={-1} className="mb-2">Saved on this phone.</h1>
            <p className="mb-8 text-ink-soft">It will get its item number the next time you have signal. Nothing is lost.</p>
            <button type="button" className="btn btn-primary btn-block" onClick={another}><Icon name="camera" /> Add another item</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Add an item" back={wip.step === 'capture' ? undefined : true}>
        {(wip.photos.length > 0 || wip.title) && (
          <button type="button" className="btn btn-quiet min-h-11" onClick={() => setConfirmDiscard(true)}>Discard</button>
        )}
      </PageHeader>
      {busy && <p className="mb-4"><Spinner label={busy} /></p>}

      {/* ------------------------------------------------------------ capture */}
      {wip.step === 'capture' && (
        <div>
          {wip.photos.length > 0 && (
            <div className="mb-5">
              <div className="mb-3 flex flex-wrap gap-3">
                {wip.photos.map((p, i) => (
                  <div key={p.sha256} className="w-24">
                    <PhotoPreview sha={p.thumb_sha256} />
                    <select
                      className="mt-1 w-full rounded-md border border-line bg-surface px-1 py-1 text-[0.8rem]"
                      value={p.kind}
                      aria-label={`What photo ${i + 1} shows`}
                      onChange={(e) => set({ photos: wip.photos.map((x, j) => (j === i ? { ...x, kind: e.target.value as MediaKind } : x)) })}
                    >
                      {(['FULL_ITEM', 'MARK', 'SERIAL', 'DAMAGE', 'PACKAGING', 'BARCODE', 'OTHER'] as MediaKind[]).map((k) => (
                        <option key={k} value={k}>{MEDIA_KIND_LABELS[k]}</option>
                      ))}
                    </select>
                    <ActionDialog
                      open={confirmDiscard}
                      onClose={() => setConfirmDiscard(false)}
                      title="Discard this unfinished item?"
                      confirmLabel="Discard item"
                      danger
                      onConfirm={discard}
                    >
                      Photos taken for this item will be removed from this phone.
                    </ActionDialog>
                  </div>
                ))}
              </div>
              <p className="text-ink-soft">Helpful extra photos: maker's mark, serial number, damage, the box or paperwork.</p>
            </div>
          )}
          <div className="grid gap-3">
            <button ref={captureButtonRef} type="button" className="btn btn-primary btn-block min-h-16 text-lg" onClick={() => fileRef.current?.click()}>
              <Icon name="camera" size={26} /> {wip.photos.length ? 'Take another photo' : 'Take photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" className="btn btn-secondary btn-block min-h-14" onClick={() => libraryRef.current?.click()}>
              <Icon name="copy" /> Choose photos (taken earlier)
            </button>
            <input ref={libraryRef} type="file" accept="image/*" multiple className="sr-only" aria-label="Choose photos from your library" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" className="btn btn-secondary btn-block min-h-14" onClick={() => go('scan')}>
              <Icon name="barcode" /> Scan barcode
            </button>
            <button type="button" className="btn btn-secondary btn-block min-h-14" onClick={() => go('details')}>
              <Icon name="pencil" /> {wip.photos.length ? 'Continue to details' : 'Enter description'}
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------- scan */}
      {wip.step === 'scan' && (
        <div>
          <h2 ref={stepHeadingRef} tabIndex={-1} className="mb-3">Scan barcode</h2>
          <Scanner onDetect={(d) => void onBarcode(d.value, d.format)} hint="Hold the barcode inside the frame. It reads even with no signal." />
        </div>
      )}

      {/* ------------------------------------------------------------ details */}
      {wip.step === 'details' && (
        <form onSubmit={(e) => { e.preventDefault(); toNext(); }}>
          {wip.barcode && <p className="mb-4">Barcode: <code>{wip.barcode}</code></p>}
          {suggestion && !wip.title && (
            <Notice tone="progress" icon="barcode">
              This barcode usually means “{suggestion}”.{' '}
              <button type="button" className="font-bold underline" onClick={() => { set({ title: suggestion }); setSuggestion(null); }}>Use it</button>
            </Notice>
          )}
          <Field label="Short description" htmlFor="title" hint="A few words, like “Brass floor lamp”. You can use the microphone on your keyboard.">
            <input id="title" className="input" value={wip.title} onChange={(e) => set({ title: e.target.value })} autoFocus required />
          </Field>
          <Field label="Where was it found?" htmlFor="found" hint="The room. It becomes part of the item's code.">
            <LocationPicker id="found" data={data} value={wip.foundLocationId} onChange={(v) => set({ foundLocationId: v, locationId: wip.locationId ?? v })} allowNone noneLabel="Not sure" kinds={['PROPERTY', 'AREA', 'CONTAINER']} />
          </Field>
          <Field label="Where is it going now?" htmlFor="place" hint="A box, staging area, or the holding area. Leave as is if it stays where it was found.">
            <LocationPicker id="place" data={data} value={wip.locationId ?? wip.foundLocationId ?? estate?.default_location_id ?? null} onChange={(v) => set({ locationId: v })} kinds={['PROPERTY', 'AREA', 'CONTAINER', 'STAGING', 'HOLDING']} createKind="CONTAINER" />
          </Field>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field label="Kind of item" htmlFor="cat">
              <CategoryPicker id="cat" value={wip.category} onChange={(v) => set({ category: v })} />
            </Field>
            <Field label="How many" htmlFor="qty">
              <input id="qty" className="input tabular" type="number" min={1} inputMode="numeric" value={wip.quantity} onChange={(e) => set({ quantity: Math.max(1, Number(e.target.value) || 1) })} />
            </Field>
          </div>
          <p className="mb-5 -mt-2 text-[0.92rem] text-ink-soft">
            Use “how many” only for things that stay together, like a set of 8 chairs. If two identical items could go to different people, record each one separately.
          </p>

          <button type="button" className="btn btn-quiet mb-4 px-0" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
            <Icon name={showMore ? 'back' : 'plus'} size={18} /> {showMore ? 'Fewer details' : 'More details (optional)'}
          </button>
          {showMore && (
            <div>
              <div className="grid gap-x-3 sm:grid-cols-2">
                <Field label="Brand or maker" htmlFor="brand"><input id="brand" className="input" value={wip.brand} onChange={(e) => set({ brand: e.target.value })} /></Field>
                <Field label="Model" htmlFor="model"><input id="model" className="input" value={wip.model} onChange={(e) => set({ model: e.target.value })} /></Field>
                <Field label="Serial number" htmlFor="serial"><input id="serial" className="input code" value={wip.serial_number} onChange={(e) => set({ serial_number: e.target.value })} /></Field>
                <Field label="Condition" htmlFor="cond"><input id="cond" className="input" value={wip.condition} onChange={(e) => set({ condition: e.target.value })} placeholder="e.g. Good, chipped rim" /></Field>
              </div>
              <Field label="Markings or inscriptions" htmlFor="marks" hint="Maker's marks, signatures, engravings, hallmarks, writing on the back.">
                <textarea id="marks" className="input" value={wip.markings ?? ''} onChange={(e) => set({ markings: e.target.value })} />
              </Field>
              <div className="-mt-3 mb-5 flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-secondary" onClick={() => markRef.current?.click()}><Icon name="camera" size={18} /> Add a photo of the marking</button>
                <input ref={markRef} type="file" accept="image/*" capture="environment" multiple className="sr-only" aria-label="Photo of the marking" onChange={(e) => { void addFiles(e.target.files, 'MARK'); e.target.value = ''; }} />
                {wip.photos.filter((p) => p.kind === 'MARK').map((p) => <PhotoPreview key={p.sha256} sha={p.thumb_sha256} />)}
              </div>
              <Field label="Barcode" htmlFor="bc"><input id="bc" className="input code" value={wip.barcode} onChange={(e) => set({ barcode: e.target.value })} /></Field>
              <Field label="Notes" htmlFor="notes"><textarea id="notes" className="input" value={wip.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
              <label className="mb-4 flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-6 w-6" checked={wip.potentially_valuable} onChange={(e) => set({ potentially_valuable: e.target.checked })} />
                <span><b>Might be valuable or collectible</b><br /><span className="text-ink-soft">Signature, maker's mark, precious metal, original packaging, older coins, art, jewelry…</span></span>
              </label>
              <label className="mb-2 flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-6 w-6" checked={wip.do_not_move} onChange={(e) => set({ do_not_move: e.target.checked })} />
                <span><b>Hold in place</b><br /><span className="text-ink-soft">Do not sell, donate, move, or separate from its set.</span></span>
              </label>
              {wip.do_not_move && (
                <Field label="Why hold it?" htmlFor="hold"><input id="hold" className="input" value={wip.do_not_move_reason} onChange={(e) => set({ do_not_move_reason: e.target.value })} placeholder="e.g. Part of a matched set of 8" /></Field>
              )}
            </div>
          )}
          <ErrorText error={error} />
          <button className="btn btn-primary btn-block mt-2">Next</button>
        </form>
      )}

      {/* --------------------------------------------------------- duplicates */}
      {wip.step === 'duplicates' && (
        <div>
          <h2 ref={stepHeadingRef} tabIndex={-1} className="mb-2">Is this already in the inventory?</h2>
          <p className="mb-5 text-ink-soft">These look similar. Checking now prevents double entries.</p>
          {candidates.slice(0, 3).map((c) => (
            <div key={c.item.id} className="panel mb-4 p-4">
              <div className="mb-3 flex gap-3">
                <Thumb media={data.media.find((m) => m.item_id === c.item.id)} size={72} />
                <div className="min-w-0">
                  <p className="font-bold">#{c.item.inventory_number} {c.item.title}</p>
                  <p className="text-[0.92rem] text-ink-soft">{locationPath(c.item.current_location_id, locs)}</p>
                  <p className="text-[0.92rem]">{c.reasons.map((r) => DUPLICATE_REASON_LABELS[r]).join(' and ')}</p>
                  <div className="mt-1"><StatusChip status={c.item.status} /></div>
                </div>
              </div>
              <div className="grid gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => void sameItem(c, false)}>It's the same item (add my photos to it)</button>
                <button type="button" className="btn btn-secondary" onClick={() => void sameItem(c, true)}>Another one: add to its quantity</button>
              </div>
            </div>
          ))}
          <div className="grid gap-2">
            <button type="button" className="btn btn-primary" onClick={() => { set({ checks: candidates.slice(0, 3).map((c) => ({ other_item_id: c.item.id, verdict: 'DIFFERENT_ITEMS', reasons: c.reasons })) }); go('next'); }}>
              It's a different item (record it separately)
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => { set({ checks: candidates.slice(0, 3).map((c) => ({ other_item_id: c.item.id, verdict: 'UNSURE', reasons: c.reasons })) }); go('next'); }}>
              Not sure (save it and flag for review)
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------- next */}
      {wip.step === 'next' && (
        <div>
          <h2 ref={stepHeadingRef} tabIndex={-1} className="mb-2">What should happen to it?</h2>
          <p className="mb-5 text-ink-soft">Anything other than “Keep for review” becomes a proposal the family approves. Nothing leaves without approval.</p>
          <fieldset className="mb-5 grid gap-2">
            <legend className="sr-only">Next step</legend>
            {([
              ['review', 'Keep for review', 'Decide later'],
              ['grab', 'Up for grabs', 'Ask everyone if they want it'],
              ['assign', 'Give to a family member', 'Propose who receives it'],
              ['sell', 'Possible sale', 'Propose selling it'],
              ['donate', 'Possible donation', 'Propose donating it'],
              ['appraisal', 'Professional appraisal', 'Flag for an expert opinion'],
              ['dispose', 'Trash or recycle', 'Propose throwing it away or recycling'],
            ] as [Wip['next'], string, string][]).map(([value, label, detail]) => (
              <label key={value} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-2 ${wip.next === value ? 'border-action bg-sunk' : 'border-line bg-surface'}`}>
                <input type="radio" name="next" className="h-5 w-5" checked={wip.next === value} onChange={() => set({ next: value })} />
                <span><b className="block">{label}</b><span className="text-[0.92rem] text-ink-soft">{detail}</span></span>
              </label>
            ))}
          </fieldset>
          {wip.next === 'assign' && (
            <Field label="Who should receive it?" htmlFor="recipient">
              <MemberPicker id="recipient" data={data} value={wip.recipient} onChange={(v) => set({ recipient: v })} />
            </Field>
          )}
          {(wip.next === 'sell' || wip.next === 'donate') && (
            <Field label={wip.next === 'sell' ? 'Buyer or where to sell (optional)' : 'Organization (optional)'} htmlFor="org">
              <input id="org" className="input" value={wip.organization} onChange={(e) => set({ organization: e.target.value })} placeholder={wip.next === 'donate' ? 'e.g. Habitat ReStore' : 'e.g. Estate sale company'} />
            </Field>
          )}
          {wip.next === 'dispose' && (
            <Field label="Which?" htmlFor="dispose">
              <select id="dispose" className="input" value={wip.disposeAs} onChange={(e) => set({ disposeAs: e.target.value as Wip['disposeAs'] })}>
                <option value="DISPOSE">Throw away</option>
                <option value="RECYCLE">Recycle</option>
              </select>
            </Field>
          )}
          <ErrorText error={error} />
          <button type="button" className="btn btn-primary btn-block min-h-16 text-lg" onClick={() => void save()} disabled={!!busy}>
            <Icon name="check" size={24} /> Save item
          </button>
        </div>
      )}
    </div>
  );
}
