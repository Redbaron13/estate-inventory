import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ROLE_LABELS, memberName, type ApprovalRule, type ClaimMode, type Member, type MemberRole,
} from '../../supabase/functions/_shared/domain.ts';
import { Icon } from '../components/Icon';
import { LocationPicker } from '../components/pickers';
import { Dialog, ErrorText, Field, Notice, PageHeader, ToneChip } from '../components/ui';
import { online } from '../lib/actions';
import { db, setMeta } from '../lib/db';
import { useEstateData, useEstateId, useMe, useMeta, useMyMembership, useOnline } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import { syncNow } from '../lib/sync';

const ROLES: MemberRole[] = ['ADMINISTRATOR', 'EXECUTOR', 'BENEFICIARY', 'FAMILY_MEMBER', 'APPRAISER', 'VIEW_ONLY'];
const PERMS: [keyof Member, string][] = [
  ['can_add_items', 'Add items'], ['can_edit_items', 'Edit items'], ['can_propose', 'Propose decisions'],
  ['can_approve', 'Approve decisions'], ['can_export', 'Reports and backups'],
];

function Profile() {
  const profile = useMeta<{ display_name?: string; phone?: string; large_text?: boolean; simplified_mode?: boolean } | null>('my_profile', null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setName(profile?.display_name ?? ''); setPhone(profile?.phone ?? ''); }, [profile?.display_name, profile?.phone]);
  async function save(patch: Record<string, unknown>) {
    const updated = await online.updateProfile(patch);
    await setMeta('my_profile', updated);
    document.documentElement.classList.toggle('large-text', !!updated.large_text);
    setMsg('Saved.');
  }
  return (
    <section className="mb-8" aria-labelledby="me-h">
      <h2 id="me-h" className="mb-3">You</h2>
      <form onSubmit={(e) => { e.preventDefault(); void save({ display_name: name, phone }); }}>
        <Field label="Your name, as family sees it" htmlFor="pf-name"><input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone (optional)" htmlFor="pf-phone"><input id="pf-phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <button className="btn btn-secondary mb-4">Save</button>
      </form>
      <label className="mb-3 flex items-center gap-3"><input type="checkbox" className="h-6 w-6" checked={!!profile?.large_text} onChange={(e) => void save({ large_text: e.target.checked })} /><b>Larger text</b></label>
      <label className="flex items-center gap-3"><input type="checkbox" className="h-6 w-6" checked={!!profile?.simplified_mode} onChange={(e) => void save({ simplified_mode: e.target.checked })} /><b>Simplified mode</b> <span className="text-ink-soft">(fewer options on screen)</span></label>
      {msg && <p className="mt-2 text-ink-soft" role="status">{msg}</p>}
    </section>
  );
}

function Password() {
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function change(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    if (password.length < 10) {
      setError('Use at least 10 characters.');
      return;
    }
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) setError(err.message);
    else {
      setPassword('');
      setMsg('Password changed.');
    }
  }
  return (
    <section className="mb-8" aria-labelledby="pw-h">
      <h2 id="pw-h" className="mb-3">Password</h2>
      <form onSubmit={(e) => void change(e)}>
        <Field label="New password" htmlFor="pw-new" hint="At least 10 characters.">
          <input id="pw-new" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn btn-secondary">Change password</button>
      </form>
      <ErrorText error={error} />
      {msg && <p className="mt-2 text-ink-soft" role="status">{msg}</p>}
    </section>
  );
}

function Members({ estateId, manager }: { estateId: string; manager: boolean }) {
  const data = useEstateData(estateId)!;
  const me = useMe();
  const [editing, setEditing] = useState<Member | null>(null);
  const [draft, setDraft] = useState<Partial<Member>>({});
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!editing) return;
    setError(null);
    try {
      await online.updateMember(estateId, editing.user_id, draft);
      await syncNow();
      setEditing(null);
    } catch (e) { setError((e as Error).message); }
  }
  async function remove(m: Member) {
    const reason = window.prompt(`Why is ${memberName(m.user_id, data)} being removed? Their history stays.`);
    if (!reason) return;
    try { await online.removeMember(estateId, m.user_id, reason); await syncNow(); } catch (e) { window.alert((e as Error).message); }
  }
  return (
    <section className="mb-8" aria-labelledby="mem-h">
      <h2 id="mem-h" className="mb-3">Family members</h2>
      <ul className="divide-y divide-line border-y border-line">
        {data.members.sort((a, b) => Number(b.is_active) - Number(a.is_active)).map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 py-3">
            <span className="tag" style={{ fontSize: '0.9rem' }}>{m.member_code}</span>
            <span className="min-w-0 flex-1">
              <b className="block">{memberName(m.user_id, data)}{m.user_id === me ? ' (you)' : ''}</b>
              <span className="text-[0.9rem] text-ink-soft">{ROLE_LABELS[m.role]}{m.is_active ? '' : `. Removed: ${m.removal_reason ?? ''}`}</span>
            </span>
            {!m.is_active && <ToneChip tone="neutral">Removed</ToneChip>}
            {m.is_active && (manager || m.user_id === me) && (
              <button type="button" className="btn btn-quiet" onClick={() => { setEditing(m); setDraft({ role: m.role, member_code: m.member_code ?? '' }); }}>Edit</button>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? memberName(editing.user_id, data) : ''}>
        {editing && (
          <div>
            <Field label="Code in item numbers (2 letters)" htmlFor="mc" hint="Used for items entered from now on.">
              <input id="mc" className="input code uppercase" maxLength={2} value={draft.member_code ?? ''} onChange={(e) => setDraft({ ...draft, member_code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
            </Field>
            {manager && (
              <>
                <Field label="Role" htmlFor="mr" hint="The executor is the person named by the will or the court. The app does not decide legal authority.">
                  <select id="mr" className="input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as MemberRole })}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </Field>
                <fieldset className="mb-5">
                  <legend className="field-label">Permissions</legend>
                  {PERMS.map(([k, label]) => (
                    <label key={k} className="mb-2 flex items-center gap-3">
                      <input type="checkbox" className="h-6 w-6" checked={(draft[k] as boolean | undefined) ?? (editing[k] as boolean)} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} /> {label}
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            <ErrorText error={error} />
            <button type="button" className="btn btn-primary btn-block mb-3" onClick={() => void save()}>Save</button>
            {manager && editing.user_id !== me && <button type="button" className="btn btn-quiet btn-block" onClick={() => { void remove(editing); setEditing(null); }}>Remove from this estate</button>}
          </div>
        )}
      </Dialog>
    </section>
  );
}

function Invites({ estateId }: { estateId: string }) {
  const data = useEstateData(estateId)!;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('BENEFICIARY');
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = data.invites.filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date());
  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await online.createInvite(estateId, email.trim(), role);
      setCode(r.code);
      await syncNow();
    } catch (err) { setError((err as Error).message); }
  }
  const pretty = code?.match(/.{1,4}/g)?.join('-') ?? '';
  const link = code ? `${location.origin}${import.meta.env.BASE_URL}join?code=${code}` : '';
  const message = code ? `You're invited to the "${data.estate?.name}" estate inventory. Open ${link} and sign in with ${email}. Invitation code: ${pretty}` : '';
  return (
    <section className="mb-8" aria-labelledby="inv-h">
      <h2 id="inv-h" className="mb-3">Invite someone</h2>
      {code ? (
        <div className="panel p-4">
          <p className="mb-2">Send this privately (text message is fine). It works once and expires in 14 days.</p>
          <p className="code mb-3 text-xl font-bold">{pretty}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {'share' in navigator && <button type="button" className="btn btn-primary" onClick={() => void navigator.share({ text: message })}><Icon name="share" /> Send invitation</button>}
            <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard?.writeText(message)}><Icon name="copy" /> Copy message</button>
          </div>
          <button type="button" className="btn btn-quiet mt-3" onClick={() => { setCode(null); setEmail(''); }}>Invite another person</button>
        </div>
      ) : (
        <form onSubmit={invite}>
          <Field label="Their email address" htmlFor="iv-email"><input id="iv-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role" htmlFor="iv-role">
            <select id="iv-role" className="input" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
          <button className="btn btn-primary btn-block">Create invitation</button>
          <ErrorText error={error} />
        </form>
      )}
      {pending.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {pending.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
              <span>{i.email} <span className="text-ink-soft">({ROLE_LABELS[i.role].toLowerCase()})</span></span>
              <button type="button" className="btn btn-quiet" onClick={() => void online.revokeInvite(estateId, i.id).then(() => syncNow())}>Cancel</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Settings({ estateId }: { estateId: string }) {
  const data = useEstateData(estateId)!;
  const e = data.estate!;
  const [f, setF] = useState({ ...e });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setF({ ...e }), [e]);
  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const keys = ['name', 'decedent_name', 'date_of_death', 'case_reference', 'approval_rule', 'auto_approve_below', 'unanimous_above', 'claim_mode', 'sealed_window_hours', 'help_contact_name', 'help_contact_phone', 'retention_years', 'default_location_id'] as const;
    const changes: Record<string, unknown> = {};
    for (const k of keys) if (f[k] !== e[k]) changes[k] = f[k] === '' ? null : f[k];
    if (!Object.keys(changes).length) return;
    try {
      await online.updateEstate(estateId, e.version, changes);
      await syncNow();
      setMsg('Settings saved.');
    } catch (err) { setError((err as Error).message); }
  }
  const num = (v: string) => (v === '' ? null : Number(v));
  return (
    <section className="mb-8" aria-labelledby="set-h">
      <h2 id="set-h" className="mb-3">Estate settings</h2>
      <form onSubmit={save}>
        <Field label="Estate name" htmlFor="s-name"><input id="s-name" className="input" value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} /></Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Person who passed" htmlFor="s-dec"><input id="s-dec" className="input" value={f.decedent_name ?? ''} onChange={(ev) => setF({ ...f, decedent_name: ev.target.value })} /></Field>
          <Field label="Date of death" htmlFor="s-dod"><input id="s-dod" type="date" className="input" value={f.date_of_death ?? ''} onChange={(ev) => setF({ ...f, date_of_death: ev.target.value })} /></Field>
        </div>
        <Field label="Court or case reference (optional)" htmlFor="s-case"><input id="s-case" className="input" value={f.case_reference ?? ''} onChange={(ev) => setF({ ...f, case_reference: ev.target.value })} /></Field>
        <Field label="Who approves decisions" htmlFor="s-rule" hint="Nobody ever approves a decision that gives an item to themselves.">
          <select id="s-rule" className="input" value={f.approval_rule} onChange={(ev) => setF({ ...f, approval_rule: ev.target.value as ApprovalRule })}>
            <option value="EXECUTOR">The executor (or administrator if no executor is named)</option>
            <option value="MAJORITY">A majority of family members with approval rights</option>
            <option value="UNANIMOUS">Everyone with approval rights</option>
          </select>
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="No approval needed below ($)" htmlFor="s-auto" hint="Uses a recorded value; never for possible valuables."><input id="s-auto" className="input tabular" inputMode="decimal" value={f.auto_approve_below ?? ''} onChange={(ev) => setF({ ...f, auto_approve_below: num(ev.target.value) })} /></Field>
          <Field label="Everyone must approve above ($)" htmlFor="s-una"><input id="s-una" className="input tabular" inputMode="decimal" value={f.unanimous_above ?? ''} onChange={(ev) => setF({ ...f, unanimous_above: num(ev.target.value) })} /></Field>
        </div>
        <Field label="Up for grabs" htmlFor="s-claim" hint="Sealed: answers stay hidden until the reveal time, then everyone's are shown at once. Rounds already open keep the setting they started with.">
          <select id="s-claim" className="input" value={f.claim_mode} onChange={(ev) => setF({ ...f, claim_mode: ev.target.value as ClaimMode })}>
            <option value="SEALED">Sealed answers, revealed together</option>
            <option value="OPEN">Open: everyone sees answers as they come in</option>
          </select>
        </Field>
        {f.claim_mode === 'SEALED' && (
          <Field label="Hours answers stay sealed" htmlFor="s-hours"><input id="s-hours" className="input tabular" type="number" min={1} max={720} value={f.sealed_window_hours} onChange={(ev) => setF({ ...f, sealed_window_hours: Number(ev.target.value) || 72 })} /></Field>
        )}
        <Field label="Where scanned items go by default" htmlFor="s-default"><LocationPicker id="s-default" data={data} value={f.default_location_id} onChange={(v) => setF({ ...f, default_location_id: v })} allowCreate={false} kinds={['HOLDING', 'STAGING', 'AREA', 'CONTAINER', 'PROPERTY']} /></Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Help contact name" htmlFor="s-hn"><input id="s-hn" className="input" value={f.help_contact_name ?? ''} onChange={(ev) => setF({ ...f, help_contact_name: ev.target.value })} /></Field>
          <Field label="Help contact phone" htmlFor="s-hp"><input id="s-hp" className="input" type="tel" value={f.help_contact_phone ?? ''} onChange={(ev) => setF({ ...f, help_contact_phone: ev.target.value })} /></Field>
        </div>
        <Field label="Keep locked backups for (years)" htmlFor="s-ret" hint="Your estate attorney may have a view on the right period."><input id="s-ret" className="input tabular" type="number" min={1} max={100} value={f.retention_years} onChange={(ev) => setF({ ...f, retention_years: Number(ev.target.value) || 7 })} /></Field>
        <button className="btn btn-primary btn-block">Save settings</button>
        <ErrorText error={error} />
        {msg && <p className="mt-2 text-ink-soft" role="status">{msg}</p>}
      </form>
    </section>
  );
}

export default function Family() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const me = useMe();
  const member = useMyMembership(data, me);
  const isOnline = useOnline();
  const navigate = useNavigate();
  if (!data?.estate) return null;
  const manager = member?.role === 'ADMINISTRATOR' || member?.role === 'EXECUTOR';
  async function signOut() {
    const pending = await db.outbox.count();
    if (pending && !window.confirm(`${pending} change(s) have not uploaded yet. They stay on this phone and upload when you sign in again. Sign out?`)) return;
    await supabase.auth.signOut();
    navigate('/sign-in');
  }
  return (
    <div>
      <PageHeader title="Family and settings" back={`/e/${estateId}/more`} />
      {!isOnline && <Notice tone="attention" icon="cloudOff">Changes on this page need a connection.</Notice>}
      <Profile />
      {isOnline && <Password />}
      <Members estateId={estateId} manager={manager} />
      {manager && <Invites estateId={estateId} />}
      {manager && <Settings estateId={estateId} />}
      <button type="button" className="btn btn-quiet" onClick={() => void signOut()}><Icon name="lock" size={18} /> Sign out</button>
    </div>
  );
}
