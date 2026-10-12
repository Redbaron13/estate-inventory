import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { categoryLabel } from '../../supabase/functions/_shared/codes.ts';
import {
  ACTION_LABELS, CUSTODY_LABELS, DUPLICATE_REASON_LABELS, INTEREST_LABELS, MANUAL_STATUSES, MEDIA_KIND_LABELS,
  RESOLUTION_LABELS, STATUS_LABELS, VALUATION_LABELS, allPossibleDuplicates, byId, currentValuations, formatMoney,
  isOnProperty, locationPath, memberName, openProposalFor, openRoundFor, referenceValue, roundView, proposalView,
  type EstateData, type Interest, type Item, type ItemStatus, type Media, type Member, type ProposalAction,
  type ResolutionMethod, type ValuationType,
} from '../../supabase/functions/_shared/domain.ts';
import { Icon } from '../components/Icon';
import { CategoryPicker, LocationPicker, MemberPicker } from '../components/pickers';
import { CodeTag, Dialog, ErrorText, Field, Notice, PendingMarker, StatusChip, Thumb, ToneChip } from '../components/ui';
import {
  addPhotos, addValuation, completeProposal, createProposal, decide, invalidateDecision, openRound, recordCustody,
  redactMedia, resolveRound, reviewDuplicate, setClaim, updateItem, withdrawProposal,
} from '../lib/actions';
import { blobFile, saveFile } from '../lib/files';
import { useEstateData, useEstateId, useMe, useMyMembership } from '../lib/hooks';
import { preparePhoto } from '../lib/images';

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

function Facts({ item, data }: { item: Item; data: EstateData }) {
  const locs = byId(data.locations);
  const rows: [string, string | null | undefined][] = [
    ['Kind', `${categoryLabel(item.category)} (${item.category})`],
    ['How many', item.quantity > 1 ? String(item.quantity) : null],
    ['Found in', locationPath(item.original_location_id, locs)],
    ['Now at', locationPath(item.current_location_id, locs)],
    ['Brand or maker', item.brand], ['Model', item.model], ['Serial number', item.serial_number],
    ['Condition', item.condition], ['Barcode', item.barcode], ['Dimensions', item.dimensions], ['Markings', item.markings],
    ['History', item.provenance], ['Details', item.description], ['Notes', item.notes],
    ['Recorded by', `${memberName(item.created_by, data)}, ${fmtDate(item.created_at)}`],
    ['Last checked in person', item.physically_verified_at ? `${memberName(item.physically_verified_by, data)}, ${fmtDate(item.physically_verified_at)}` : 'Not yet'],
  ];
  return (
    <dl className="mb-6 divide-y divide-line border-y border-line">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="grid grid-cols-[9rem_1fr] gap-3 py-2.5">
          <dt className="text-ink-soft">{k}</dt>
          <dd className={k === 'Serial number' || k === 'Barcode' ? 'code' : ''}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
function EditDialog({ item, data, member, onClose }: { item: Item; data: EstateData; member: Member | null; onClose: () => void }) {
  const [f, setF] = useState({ ...item });
  const [error, setError] = useState<string | null>(null);
  const canStatus = MANUAL_STATUSES.includes(item.status);
  const manager = member?.role === 'ADMINISTRATOR' || member?.role === 'EXECUTOR';
  async function save(e: FormEvent) {
    e.preventDefault();
    const keys: (keyof Item)[] = ['title', 'description', 'category', 'quantity', 'condition', 'barcode', 'brand', 'model', 'serial_number', 'dimensions', 'weight', 'markings', 'provenance', 'notes', 'original_location_id', 'potentially_valuable', 'do_not_move', 'do_not_move_reason', 'status'];
    const changes: Partial<Item> = {};
    for (const k of keys) if (f[k] !== item[k]) (changes as Record<string, unknown>)[k] = f[k] === '' ? null : f[k];
    if (!f.title.trim()) return setError('The description cannot be empty.');
    if (changes.do_not_move === false && item.do_not_move && !manager) return setError('Only an administrator or executor can release a hold.');
    if (f.do_not_move && !f.do_not_move_reason) return setError('Say why this item should be held in place.');
    if (Object.keys(changes).length) await updateItem(item, changes);
    onClose();
  }
  const text = (k: keyof Item, label: string, opts: { area?: boolean; code?: boolean } = {}) => (
    <Field label={label} htmlFor={`e-${k}`}>
      {opts.area ? (
        <textarea id={`e-${k}`} className="input" value={(f[k] as string) ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      ) : (
        <input id={`e-${k}`} className={`input ${opts.code ? 'code' : ''}`} value={(f[k] as string) ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      )}
    </Field>
  );
  return (
    <form onSubmit={save}>
      {text('title', 'Short description')}
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label="Kind" htmlFor="e-cat"><CategoryPicker id="e-cat" value={f.category} onChange={(v) => setF({ ...f, category: v })} /></Field>
        <Field label="How many" htmlFor="e-qty"><input id="e-qty" type="number" min={1} className="input" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Math.max(1, Number(e.target.value) || 1) })} /></Field>
      </div>
      {f.category !== item.category && <p className="-mt-3 mb-4 text-[0.92rem] text-ink-soft">The item code keeps its original category ({item.category}).</p>}
      {canStatus && (
        <Field label="Status" htmlFor="e-status">
          <select id="e-status" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ItemStatus })}>
            {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </Field>
      )}
      <Field label="Where it was found" htmlFor="e-found" hint="Correcting this does not change the item code.">
        <LocationPicker id="e-found" data={data} value={f.original_location_id} onChange={(v) => setF({ ...f, original_location_id: v })} allowNone kinds={['PROPERTY', 'AREA', 'CONTAINER']} />
      </Field>
      {text('description', 'Details', { area: true })}
      <div className="grid gap-x-3 sm:grid-cols-2">
        {text('brand', 'Brand or maker')}{text('model', 'Model')}{text('serial_number', 'Serial number', { code: true })}{text('condition', 'Condition')}
        {text('barcode', 'Barcode', { code: true })}{text('dimensions', 'Dimensions')}
      </div>
      {text('markings', 'Markings or inscriptions', { area: true })}
      {text('provenance', 'Known history', { area: true })}
      {text('notes', 'Notes', { area: true })}
      <label className="mb-4 flex items-center gap-3"><input type="checkbox" className="h-6 w-6" checked={f.potentially_valuable} onChange={(e) => setF({ ...f, potentially_valuable: e.target.checked })} /><b>Might be valuable or collectible</b></label>
      <label className="mb-3 flex items-center gap-3"><input type="checkbox" className="h-6 w-6" checked={f.do_not_move} onChange={(e) => setF({ ...f, do_not_move: e.target.checked })} disabled={item.do_not_move && !manager} /><b>Hold in place</b></label>
      {f.do_not_move && text('do_not_move_reason', 'Why hold it?')}
      <ErrorText error={error} />
      <button className="btn btn-primary btn-block">Save changes</button>
    </form>
  );
}

function MoveDialog({ item, data, onClose }: { item: Item; data: EstateData; onClose: () => void }) {
  const [to, setTo] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [whoName, setWhoName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const locs = byId(data.locations);
  const leaving = to ? !isOnProperty(to, locs) : false;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!to) return setError('Choose where it went.');
    if (leaving && !who && !whoName.trim()) return setError('Record who took it.');
    if (leaving && !purpose.trim()) return setError('Record why it was taken.');
    await recordCustody(item, {
      event_type: leaving ? 'HANDOFF' : 'MOVED', to_location_id: to, received_by_user_id: who,
      received_by_name: whoName.trim() || null, purpose: purpose.trim() || null, notes: notes.trim() || null,
    });
    onClose();
  }
  return (
    <form onSubmit={save}>
      {item.do_not_move && <Notice tone="warning" icon="pin">This item is marked “Hold in place”. Only an administrator or executor can move it.</Notice>}
      <Field label="Move to" htmlFor="m-to">
        <LocationPicker id="m-to" data={data} value={to} onChange={setTo} createKind="CONTAINER" />
      </Field>
      {leaving && (
        <>
          <Notice tone="attention" icon="alert">This takes the item off the property. Record who has it and why. Without an approved decision it will appear in the exceptions report.</Notice>
          <Field label="Who took it (family member)" htmlFor="m-who"><MemberPicker id="m-who" data={data} value={who} onChange={setWho} allowNone /></Field>
          <Field label="Or someone else's name" htmlFor="m-name"><input id="m-name" className="input" value={whoName} onChange={(e) => setWhoName(e.target.value)} /></Field>
          <Field label="Why" htmlFor="m-why"><input id="m-why" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Taking to appraiser" /></Field>
        </>
      )}
      <Field label="Notes (optional)" htmlFor="m-notes"><input id="m-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <ErrorText error={error} />
      <button className="btn btn-primary btn-block">Record the move</button>
    </form>
  );
}

function ValueDialog({ item, data, onClose }: { item: Item; data: EstateData; onClose: () => void }) {
  const current = currentValuations(item.id, data.valuations);
  const [type, setType] = useState<ValuationType>('FAMILY_ESTIMATE');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [appraiser, setAppraiser] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [supersedes, setSupersedes] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    await addValuation(item, { valuation_type: type, amount: Number(amount), source: source || null, appraiser_name: appraiser || null, comparable_url: url || null, notes: notes || null, supersedes_id: supersedes || null });
    onClose();
  }
  return (
    <form onSubmit={save}>
      <p className="mb-4 text-ink-soft">Each kind of value is kept separately. A new value never erases an earlier one.</p>
      <Field label="Kind of value" htmlFor="v-type">
        <select id="v-type" className="input" value={type} onChange={(e) => setType(e.target.value as ValuationType)}>
          {(Object.keys(VALUATION_LABELS) as ValuationType[]).map((t) => <option key={t} value={t}>{VALUATION_LABELS[t]}</option>)}
        </select>
      </Field>
      <Field label="Amount (USD)" htmlFor="v-amt"><input id="v-amt" className="input tabular" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
      <Field label="Where this number comes from" htmlFor="v-src"><input id="v-src" className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. eBay sold listings" /></Field>
      {(type === 'FORMAL_APPRAISAL' || type === 'THIRD_PARTY_ESTIMATE') && (
        <Field label="Appraiser or expert" htmlFor="v-app"><input id="v-app" className="input" value={appraiser} onChange={(e) => setAppraiser(e.target.value)} /></Field>
      )}
      <Field label="Link to a comparable sale (optional)" htmlFor="v-url"><input id="v-url" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
      <Field label="Notes" htmlFor="v-notes"><input id="v-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {current.length > 0 && (
        <Field label="Correcting an earlier value?" htmlFor="v-sup" hint="Choose the value this one corrects. The original stays on record.">
          <select id="v-sup" className="input" value={supersedes} onChange={(e) => setSupersedes(e.target.value)}>
            <option value="">No, this is a new value</option>
            {current.map((v) => <option key={v.id} value={v.id}>{VALUATION_LABELS[v.valuation_type]}: {formatMoney(v.amount)} ({v.valuation_date})</option>)}
          </select>
        </Field>
      )}
      <button className="btn btn-primary btn-block" disabled={!amount}>Save value</button>
    </form>
  );
}

function ProposeDialog({ item, data, onClose }: { item: Item; data: EstateData; onClose: () => void }) {
  const [action, setAction] = useState<ProposalAction | 'GRAB'>('GRAB');
  const [recipient, setRecipient] = useState<string | null>(null);
  const [org, setOrg] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (action === 'GRAB') { await openRound(item, reason || undefined); return onClose(); }
    if (action === 'ASSIGN' && !recipient) return setError('Choose who receives it.');
    await createProposal(item, { action, recipient_user_id: recipient, organization: org || null, amount: amount ? Number(amount) : null, reason: reason || null });
    onClose();
  }
  const rule = data.estate?.approval_rule;
  return (
    <form onSubmit={save}>
      <fieldset className="mb-5 grid gap-2">
        <legend className="field-label">What should happen?</legend>
        {([['GRAB', 'Up for grabs: ask everyone'], ['ASSIGN', ACTION_LABELS.ASSIGN], ['SELL', ACTION_LABELS.SELL], ['DONATE', ACTION_LABELS.DONATE], ['RECYCLE', ACTION_LABELS.RECYCLE], ['DISPOSE', ACTION_LABELS.DISPOSE]] as [ProposalAction | 'GRAB', string][]).map(([v, label]) => (
          <label key={v} className={`flex min-h-12 items-center gap-3 rounded-xl border-2 px-3 ${action === v ? 'border-action bg-sunk' : 'border-line'}`}>
            <input type="radio" name="act" className="h-5 w-5" checked={action === v} onChange={() => setAction(v)} /> {label}
          </label>
        ))}
      </fieldset>
      {action === 'GRAB' && data.estate && (
        <p className="mb-4 text-ink-soft">{data.estate.claim_mode === 'SEALED' ? `Choices stay sealed for ${data.estate.sealed_window_hours} hours, then everyone's answers are shown at once.` : 'Everyone sees each answer as it comes in.'}</p>
      )}
      {action === 'ASSIGN' && <Field label="Who receives it" htmlFor="p-rec"><MemberPicker id="p-rec" data={data} value={recipient} onChange={setRecipient} /></Field>}
      {(action === 'SELL' || action === 'DONATE') && <Field label={action === 'SELL' ? 'Buyer or where to sell' : 'Organization'} htmlFor="p-org"><input id="p-org" className="input" value={org} onChange={(e) => setOrg(e.target.value)} /></Field>}
      {(action === 'SELL' || action === 'ASSIGN') && (
        <Field label={action === 'SELL' ? 'Asking price (optional)' : 'Value credited to them (optional)'} htmlFor="p-amt"><input id="p-amt" className="input tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
      )}
      <Field label={action === 'GRAB' ? 'Note for the family (optional)' : 'Reason (optional)'} htmlFor="p-reason"><input id="p-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {action !== 'GRAB' && rule && (
        <p className="mb-4 text-[0.92rem] text-ink-soft">
          Approval rule: {rule === 'EXECUTOR' ? 'the executor approves' : rule === 'UNANIMOUS' ? 'everyone must approve' : 'a majority must approve'}. Nobody approves a proposal that gives an item to themselves.
        </p>
      )}
      <ErrorText error={error} />
      <button className="btn btn-primary btn-block">{action === 'GRAB' ? 'Put up for grabs' : 'Send proposal'}</button>
    </form>
  );
}

function CompleteDialog({ proposalId, data, onClose }: { proposalId: string; data: EstateData; onClose: () => void }) {
  const p = data.proposals.find((x) => x.id === proposalId)!;
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [who, setWho] = useState(p.organization ?? p.recipient_name ?? '');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const prepared = receipt ? { ...(await preparePhoto(receipt)), kind: 'RECEIPT' as const } : null;
    await completeProposal(p, { occurred_at: new Date(date).toISOString(), received_by_name: who || null, final_amount: amount ? Number(amount) : null, notes: notes || null, receipt: prepared });
    setBusy(false);
    onClose();
  }
  return (
    <form onSubmit={save}>
      <p className="mb-4">Record that this happened: <b>{ACTION_LABELS[p.action]}</b>{p.recipient_user_id ? ` to ${memberName(p.recipient_user_id, data)}` : ''}.</p>
      <Field label="When" htmlFor="c-date"><input id="c-date" type="datetime-local" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {p.action !== 'ASSIGN' && <Field label="Received by" htmlFor="c-who"><input id="c-who" className="input" value={who} onChange={(e) => setWho(e.target.value)} /></Field>}
      {(p.action === 'SELL' || p.action === 'DONATE') && <Field label={p.action === 'SELL' ? 'Actual sale price' : 'Donation value on the receipt'} htmlFor="c-amt"><input id="c-amt" className="input tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>}
      <Field label="Receipt or handoff photo (optional)" htmlFor="c-rec">
        <input id="c-rec" type="file" accept="image/*" capture="environment" className="input" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Notes" htmlFor="c-notes"><input id="c-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <button className="btn btn-primary btn-block" disabled={busy}>Record it</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
function RoundSection({ item, data, me, member }: { item: Item; data: EstateData; me: string; member: Member | null }) {
  const round = openRoundFor(item.id, data, me);
  const [method, setMethod] = useState<ResolutionMethod>('SOLE_INTEREST');
  const [winner, setWinner] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  if (!round) return null;
  const manager = member?.role === 'ADMINISTRATOR' || member?.role === 'EXECUTOR';
  const canClaim = member && !['VIEW_ONLY', 'APPRAISER'].includes(member.role);
  const open = round.round.mode === 'OPEN' || round.sealed;
  const answer = (i: Interest) => void setClaim(item, i, note || null, round.round.id);
  const n = round.interested.length;
  return (
    <section className="panel mb-6 p-4" aria-labelledby="grab-h">
      <h2 id="grab-h" className="mb-2">Up for grabs</h2>
      {round.round.note && <p className="mb-3 italic">“{round.round.note}”</p>}
      {round.sealed ? (
        <p className="mb-3">Choices are sealed until <b>{fmtDate(round.round.reveal_at)}</b>. Nobody, including administrators, can see other people's answers before then.</p>
      ) : round.round.mode === 'SEALED' ? (
        <p className="mb-3">Choices were revealed {fmtDate(round.round.reveal_at)}.</p>
      ) : null}
      {round.myClaim && <p className="mb-3">Your answer: <b>{INTEREST_LABELS[round.myClaim.interest]}</b>{round.myClaim.note ? ` (“${round.myClaim.note}”)` : ''}</p>}
      {open && canClaim && (
        <>
          <Field label="Note (optional)" htmlFor="claim-note"><input id="claim-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. It was in my room growing up" /></Field>
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            {(['INTERESTED', 'NOT_INTERESTED', 'NEED_INFO'] as Interest[]).map((i) => (
              <button key={i} type="button" className={`btn ${round.myClaim?.interest === i ? 'btn-primary' : 'btn-secondary'}`} onClick={() => answer(i)}>{INTEREST_LABELS[i]}</button>
            ))}
          </div>
          {!navigator.onLine && round.sealed && <p className="mb-3 text-[0.92rem] text-ink-soft">You're offline. Your answer counts when it reaches the server, so send it before the reveal time.</p>}
        </>
      )}
      {!round.sealed && (
        <div className="mb-3">
          <p><b>{n ? `${n} want${n === 1 ? 's' : ''} it:` : 'Nobody has said they want it yet.'}</b> {round.interested.map((u) => memberName(u, data)).join(', ')}</p>
          {round.needInfo.length > 0 && <p className="text-ink-soft">Need more information: {round.needInfo.map((u) => memberName(u, data)).join(', ')}</p>}
        </div>
      )}
      {!round.sealed && member?.can_propose && (
        <details className="mt-2">
          <summary className="cursor-pointer font-bold text-action">Settle this round</summary>
          <div className="pt-3">
            <Field label="How was it decided?" htmlFor="r-method">
              <select id="r-method" className="input" value={method} onChange={(e) => setMethod(e.target.value as ResolutionMethod)}>
                {n === 1 && <option value="SOLE_INTEREST">{RESOLUTION_LABELS.SOLE_INTEREST}</option>}
                {n === 0 && <option value="NO_INTEREST">{RESOLUTION_LABELS.NO_INTEREST}</option>}
                {n >= 2 && <option value="RANDOM_DRAW">{RESOLUTION_LABELS.RANDOM_DRAW} (the app picks fairly and records how)</option>}
                {manager && n >= 1 && (['DISCUSSION', 'ROTATION', 'INHERITANCE_CREDIT', 'PURCHASE'] as ResolutionMethod[]).map((m) => <option key={m} value={m}>{RESOLUTION_LABELS[m]}</option>)}
                {manager && <option value="CANCELLED">{RESOLUTION_LABELS.CANCELLED}</option>}
              </select>
            </Field>
            {['DISCUSSION', 'ROTATION', 'INHERITANCE_CREDIT', 'PURCHASE'].includes(method) && (
              <Field label="Who receives it" htmlFor="r-win">
                <select id="r-win" className="input" value={winner ?? ''} onChange={(e) => setWinner(e.target.value || null)}>
                  <option value="">Choose</option>
                  {round.interested.map((u) => <option key={u} value={u}>{memberName(u, data)}</option>)}
                </select>
              </Field>
            )}
            {!['SOLE_INTEREST', 'NO_INTEREST', 'RANDOM_DRAW'].includes(method) && (
              <Field label="Record the reason" htmlFor="r-reason"><input id="r-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            )}
            <button type="button" className="btn btn-primary btn-block" onClick={() => void resolveRound(item, round.round.id, method, { winner_user_id: winner, reason: reason || null })}>Settle</button>
            <p className="mt-2 text-[0.92rem] text-ink-soft">A winner gets an assignment proposal, which still goes through approval.</p>
          </div>
        </details>
      )}
    </section>
  );
}

function ProposalSection({ item, data, me, member }: { item: Item; data: EstateData; me: string; member: Member | null }) {
  const view = openProposalFor(item.id, data);
  const [comment, setComment] = useState('');
  const [completing, setCompleting] = useState(false);
  if (!view) return null;
  const p = view.proposal;
  const mine = view.status === 'PENDING' && view.eligible.includes(me);
  const manager = member?.role === 'ADMINISTRATOR' || member?.role === 'EXECUTOR';
  const canWithdraw = p.requested_by === me || manager;
  return (
    <section className="panel mb-6 p-4" aria-labelledby="prop-h">
      <h2 id="prop-h" className="mb-1">{view.status === 'APPROVED' ? 'Approved' : 'Proposed'}: {ACTION_LABELS[p.action]}</h2>
      <p className="mb-3 text-ink-soft">
        {p.recipient_user_id ? `To ${memberName(p.recipient_user_id, data)}. ` : ''}{p.organization ? `${p.organization}. ` : ''}
        {p.amount !== null ? `${formatMoney(p.amount)}. ` : ''}Requested by {memberName(p.requested_by, data)}, {fmtDate(p.created_at)}.
      </p>
      {p.reason && <p className="mb-3">“{p.reason}”</p>}
      <ul className="mb-4 divide-y divide-line border-y border-line">
        {view.eligible.map((u) => {
          const d = view.effective.get(u);
          return (
            <li key={u} className="flex items-center justify-between gap-2 py-2">
              <span>{memberName(u, data)}{d?.comment ? <span className="block text-[0.9rem] text-ink-soft">“{d.comment}”</span> : null}</span>
              {d ? (
                <span className="flex items-center gap-2">
                  <ToneChip tone={d.decision === 'APPROVE' ? 'done' : d.decision === 'REJECT' ? 'warning' : 'neutral'} icon={d.decision === 'APPROVE' ? 'check' : d.decision === 'REJECT' ? 'x' : 'more'}>
                    {d.decision === 'APPROVE' ? 'Approved' : d.decision === 'REJECT' ? 'Rejected' : 'Abstained'}
                  </ToneChip>
                  {member?.role === 'ADMINISTRATOR' && view.status === 'PENDING' && d.user_id !== me && (
                    <button type="button" className="text-[0.85rem] font-bold text-action underline" onClick={() => { const r = window.prompt('Why set this decision aside? The original stays visible.'); if (r) void invalidateDecision(p.estate_id, d.id, item.id, r); }}>Set aside</button>
                  )}
                </span>
              ) : (
                <ToneChip tone="attention" icon="history">Waiting</ToneChip>
              )}
            </li>
          );
        })}
        {p.auto_approved && <li className="py-2">Approved automatically (value below the estate's threshold).</li>}
      </ul>
      {mine && (
        <div className="mb-3">
          <Field label="Comment (optional)" htmlFor="d-comment"><input id="d-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" className="btn btn-primary" onClick={() => void decide(p, 'APPROVE', comment)}>Approve</button>
            <button type="button" className="btn btn-danger" onClick={() => void decide(p, 'REJECT', comment)}>Reject</button>
            <button type="button" className="btn btn-secondary" onClick={() => void decide(p, 'ABSTAIN', comment)}>Abstain</button>
          </div>
        </div>
      )}
      {view.status === 'APPROVED' && (
        <button type="button" className="btn btn-primary btn-block mb-2" onClick={() => setCompleting(true)}><Icon name="check" /> Record that it happened</button>
      )}
      {canWithdraw && (
        <button type="button" className="btn btn-quiet" onClick={() => { const r = window.prompt(view.status === 'APPROVED' ? 'Why is this approved decision being cancelled?' : 'Why withdraw this proposal?'); if (r) void withdrawProposal(p, r); }}>
          {view.status === 'APPROVED' ? 'Cancel (it fell through)' : 'Withdraw proposal'}
        </button>
      )}
      <Dialog open={completing} onClose={() => setCompleting(false)} title="Record that it happened">
        <CompleteDialog proposalId={p.id} data={data} onClose={() => setCompleting(false)} />
      </Dialog>
    </section>
  );
}

function History({ item, data, me }: { item: Item; data: EstateData; me: string }) {
  const locs = byId(data.locations);
  const events: { at: string; text: string; who: string | null }[] = [
    { at: item.created_at, text: `Recorded with code ${item.item_code}`, who: item.created_by },
    ...data.custody_events.filter((e) => e.item_id === item.id).map((e) => ({
      at: e.occurred_at, who: e.recorded_by,
      text: `${CUSTODY_LABELS[e.event_type]}${e.to_location_id ? ` to ${locationPath(e.to_location_id, locs)}` : ''}${e.received_by_name ? `, received by ${e.received_by_name}` : e.received_by_user_id ? `, received by ${memberName(e.received_by_user_id, data)}` : ''}${e.purpose ? ` (${e.purpose})` : ''}`,
    })),
    ...data.valuations.filter((v) => v.item_id === item.id).map((v) => ({ at: v.created_at, who: v.entered_by, text: `${VALUATION_LABELS[v.valuation_type]}: ${formatMoney(v.amount)}${v.supersedes_id ? ' (correction)' : ''}` })),
    ...data.proposals.filter((p) => p.item_id === item.id).flatMap((p) => {
      const v = proposalView(p, data);
      const out: { at: string; who: string | null; text: string }[] = [{ at: p.created_at, who: p.requested_by, text: `Proposed: ${ACTION_LABELS[p.action]}${p.recipient_user_id ? ` to ${memberName(p.recipient_user_id, data)}` : ''}` }];
      for (const d of data.proposal_decisions.filter((d) => d.proposal_id === p.id)) out.push({ at: d.created_at, who: d.user_id, text: `${d.decision === 'APPROVE' ? 'Approved' : d.decision === 'REJECT' ? 'Rejected' : 'Abstained'}${v.invalidated.has(d.id) ? ' (later set aside)' : ''}${d.comment ? `: “${d.comment}”` : ''}` });
      if (v.outcome) out.push({ at: v.outcome.created_at, who: v.outcome.recorded_by, text: `Decision ${v.outcome.outcome.toLowerCase()}${v.outcome.note ? `. ${v.outcome.note}` : ''}` });
      if (v.cancellation) out.push({ at: v.cancellation.created_at, who: v.cancellation.cancelled_by, text: `Cancelled: ${v.cancellation.reason}` });
      return out;
    }),
    ...data.grab_rounds.filter((r) => r.item_id === item.id).flatMap((r) => {
      const rv = roundView(r, data, me);
      const out: { at: string; who: string | null; text: string }[] = [{ at: r.created_at, who: r.opened_by, text: `Put up for grabs${r.mode === 'SEALED' ? ' (sealed choices)' : ''}` }];
      for (const c of data.claims.filter((c) => c.round_id === r.id)) out.push({ at: c.created_at, who: c.user_id, text: `Answered: ${INTEREST_LABELS[c.interest]}` });
      if (rv.resolution) out.push({ at: rv.resolution.created_at, who: rv.resolution.resolved_by, text: `Settled: ${RESOLUTION_LABELS[rv.resolution.method]}${rv.resolution.winner_user_id ? `, ${memberName(rv.resolution.winner_user_id, data)}` : ''}${rv.resolution.draw_seed ? ` (draw seed ${rv.resolution.draw_seed.slice(0, 8)}…)` : ''}` });
      return out;
    }),
    ...data.duplicate_reviews.filter((d) => d.item_id === item.id || d.other_item_id === item.id).map((d) => ({ at: d.created_at, who: d.decided_by, text: `Duplicate check: ${d.verdict === 'SAME_ITEM' ? 'same item (merged)' : d.verdict === 'DIFFERENT_ITEMS' ? 'different items' : 'not sure'}` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <section aria-labelledby="hist-h" className="mb-6">
      <h2 id="hist-h" className="mb-3">History</h2>
      <ol className="border-l-2 border-line pl-4">
        {events.map((e, i) => (
          <li key={i} className="mb-3">
            <p>{e.text}</p>
            <p className="text-[0.88rem] text-ink-soft">{memberName(e.who, data)}, {fmtDate(e.at)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
export default function ItemDetail() {
  const estateId = useEstateId();
  const { itemId } = useParams();
  const data = useEstateData(estateId);
  const me = useMe();
  const member = useMyMembership(data, me);
  const [dialog, setDialog] = useState<'edit' | 'move' | 'value' | 'propose' | null>(null);
  const [viewing, setViewing] = useState<Media | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const item = data?.items.find((i) => i.id === itemId);
  const dupes = useMemo(() => (data && item ? allPossibleDuplicates(data).filter((p) => p.item.id === item.id || p.other.id === item.id) : []), [data, item]);
  if (!data || !me) return null;
  if (!item) return <Notice tone="neutral" icon="search">This item is not on this phone yet. It will appear after the next sync.</Notice>;

  const redacted = new Set(data.redactions.map((r) => r.media_id));
  const photos = data.media.filter((m) => m.item_id === item.id && !redacted.has(m.id));
  const values = currentValuations(item.id, data.valuations);
  const ref = referenceValue(item.id, data.valuations);
  const merged = item.merged_into_id ? data.items.find((i) => i.id === item.merged_into_id) : null;
  const busy = !!openProposalFor(item.id, data) || !!openRoundFor(item.id, data, me);
  const gone = ['SOLD', 'DONATED', 'DISTRIBUTED', 'DISPOSED', 'MERGED'].includes(item.status);

  async function onPhotos(files: FileList | null) {
    if (!files?.length) return;
    const prepared = [];
    for (const f of Array.from(files)) prepared.push({ ...(await preparePhoto(f)), kind: 'OTHER' as const });
    await addPhotos(item!, prepared);
  }

  return (
    <div>
      <div className="mb-4">
        <Link to={`/e/${estateId}/items`} className="btn btn-quiet -ml-2 mb-2 min-h-10 px-2"><Icon name="back" /> Inventory</Link>
        <h1 className="mb-2"><span className="tabular text-ink-soft">#{item.inventory_number}</span> {item.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <CodeTag code={item.item_code} />
          <StatusChip status={item.status} />
          {item.potentially_valuable && <ToneChip tone="attention" icon="star">Possibly valuable</ToneChip>}
          {item.do_not_move && <ToneChip tone="warning" icon="pin">Hold in place</ToneChip>}
          <PendingMarker entityId={item.id} />
        </div>
        {item.do_not_move && item.do_not_move_reason && <p className="mt-2 text-ink-soft">Held because: {item.do_not_move_reason}</p>}
      </div>

      {merged && <Notice tone="neutral" icon="copy">This record was a duplicate and was merged into <Link className="font-bold underline" to={`/e/${estateId}/items/${merged.id}`}>#{merged.inventory_number} {merged.title}</Link>.</Notice>}

      <section className="mb-6" aria-label="Photos">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((m) => (
            <button key={m.id} type="button" onClick={() => setViewing(m)} className="relative" aria-label={`View photo: ${MEDIA_KIND_LABELS[m.kind]}`}>
              <Thumb media={m} size={400} className="aspect-square h-auto! w-full!" />
              <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 text-[0.75rem] text-white">{MEDIA_KIND_LABELS[m.kind]}</span>
            </button>
          ))}
          {!gone && member?.can_add_items !== false && (
            <button type="button" className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line text-action" onClick={() => photoRef.current?.click()}>
              <Icon name="camera" size={28} /> <span className="text-[0.85rem] font-bold">Add photo</span>
            </button>
          )}
        </div>
        <input ref={photoRef} type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => { void onPhotos(e.target.files); e.target.value = ''; }} />
      </section>

      {!gone && member?.can_edit_items && (
        <div className="mb-6 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setDialog('edit')}><Icon name="pencil" /> Edit details</button>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog('move')}><Icon name="map" /> Move</button>
          <button type="button" className="btn btn-secondary" onClick={() => void updateItem(item, { mark_verified: true })}><Icon name="check" /> It's here</button>
          <button type="button" className="btn btn-secondary" onClick={async () => { const { itemLabelsPdf } = await import('../lib/pdf'); await saveFile(blobFile(itemLabelsPdf([item], data.locations), `label-${item.item_code}.pdf`, 'application/pdf')); }}><Icon name="tag" /> Print label</button>
        </div>
      )}

      {!gone && <RoundSection item={item} data={data} me={me} member={member} />}
      <ProposalSection item={item} data={data} me={me} member={member} />
      {!gone && !busy && member?.can_propose && (
        <button type="button" className="btn btn-primary btn-block mb-6" onClick={() => setDialog('propose')}><Icon name="scale" /> Decide what happens to it</button>
      )}

      <Facts item={item} data={data} />

      <section className="mb-6" aria-labelledby="val-h">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="val-h">Values</h2>
          {(member?.can_edit_items || member?.role === 'APPRAISER') && <button type="button" className="btn btn-quiet" onClick={() => setDialog('value')}><Icon name="plus" size={18} /> Add a value</button>}
        </div>
        {values.length === 0 ? <p className="text-ink-soft">No value recorded yet.</p> : (
          <ul className="divide-y divide-line border-y border-line">
            {values.map((v) => (
              <li key={v.id} className="flex justify-between gap-3 py-2.5">
                <span>{VALUATION_LABELS[v.valuation_type]}<span className="block text-[0.88rem] text-ink-soft">{[v.source, v.appraiser_name, v.valuation_date, memberName(v.entered_by, data)].filter(Boolean).join(', ')}</span></span>
                <b className="tabular">{formatMoney(v.amount)}</b>
              </li>
            ))}
          </ul>
        )}
        {ref && <p className="mt-2 text-[0.92rem] text-ink-soft">Value used for approval rules: {formatMoney(ref.amount)} ({VALUATION_LABELS[ref.type].toLowerCase()}).</p>}
      </section>

      {dupes.length > 0 && member?.can_edit_items && (
        <section className="panel mb-6 p-4" aria-labelledby="dup-h">
          <h2 id="dup-h" className="mb-3">Possible duplicate</h2>
          {dupes.map((d) => {
            const other = d.item.id === item.id ? d.other : d.item;
            return (
              <div key={other.id} className="mb-3">
                <p className="mb-2">May be the same as <Link to={`/e/${estateId}/items/${other.id}`} className="font-bold underline">#{other.inventory_number} {other.title}</Link> ({d.reasons.map((r) => DUPLICATE_REASON_LABELS[r]).join(', ')}).</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <button type="button" className="btn btn-secondary" onClick={() => void reviewDuplicate(item, other, 'SAME_ITEM', d.reasons)}>Same item: merge this into #{other.inventory_number}</button>
                  <button type="button" className="btn btn-secondary" onClick={() => void reviewDuplicate(item, other, 'DIFFERENT_ITEMS', d.reasons)}>Different items</button>
                  <button type="button" className="btn btn-quiet" onClick={() => void reviewDuplicate(item, other, 'UNSURE', d.reasons)}>Not sure</button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {!gone && member?.can_edit_items && (
        <div className="mb-6 flex flex-wrap gap-2">
          {item.status !== 'MISSING' ? (
            <button type="button" className="btn btn-quiet" onClick={() => { if (window.confirm('Report this item as missing? Everyone will see it in the exceptions report.')) void recordCustody(item, { event_type: 'REPORTED_MISSING' }); }}>Report missing</button>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => void recordCustody(item, { event_type: 'FOUND' })}>Mark as found</button>
          )}
        </div>
      )}

      <History item={item} data={data} me={me} />

      <Dialog open={dialog === 'edit'} onClose={() => setDialog(null)} title="Edit details"><EditDialog item={item} data={data} member={member} onClose={() => setDialog(null)} /></Dialog>
      <Dialog open={dialog === 'move'} onClose={() => setDialog(null)} title="Move this item"><MoveDialog item={item} data={data} onClose={() => setDialog(null)} /></Dialog>
      <Dialog open={dialog === 'value'} onClose={() => setDialog(null)} title="Add a value"><ValueDialog item={item} data={data} onClose={() => setDialog(null)} /></Dialog>
      <Dialog open={dialog === 'propose'} onClose={() => setDialog(null)} title="Decide what happens"><ProposeDialog item={item} data={data} onClose={() => setDialog(null)} /></Dialog>
      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing ? MEDIA_KIND_LABELS[viewing.kind] : ''}>
        {viewing && (
          <div>
            <Thumb media={viewing} full className="mb-4 w-full" />
            <p className="mb-4 text-[0.88rem] text-ink-soft">Added by {memberName(viewing.uploaded_by, data)}, {fmtDate(viewing.created_at)}. Fingerprint {viewing.sha256.slice(0, 16)}…</p>
            {(viewing.uploaded_by === me || member?.role === 'ADMINISTRATOR' || member?.role === 'EXECUTOR') && (
              <button type="button" className="btn btn-quiet" onClick={() => { const r = window.prompt('Why hide this photo? It is removed from view for everyone but kept in the locked backup.'); if (r) { void redactMedia(viewing, r); setViewing(null); } }}>Hide this photo (uploaded by mistake)</button>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
