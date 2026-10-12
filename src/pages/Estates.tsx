import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '../../supabase/functions/_shared/domain.ts';
import { Icon } from '../components/Icon';
import { ErrorText, Field, Notice } from '../components/ui';
import { online } from '../lib/actions';
import { useMyEstates, useOnline } from '../lib/hooks';
import { supabase } from '../lib/supabase';
import { syncNow } from '../lib/sync';
import { db } from '../lib/db';

export default function Estates() {
  const estates = useMyEstates();
  const isOnline = useOnline();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [decedent, setDecedent] = useState('');
  const [role, setRole] = useState<'ADMINISTRATOR' | 'EXECUTOR'>('ADMINISTRATOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const estate = await online.createEstate({ name: name.trim(), decedent_name: decedent.trim() || null, creator_role: role });
      await syncNow();
      navigate(`/e/${estate.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const pending = await db.outbox.count();
    if (pending && !window.confirm(`${pending} change(s) have not uploaded yet. They stay on this phone and upload when you sign in again. Sign out?`)) return;
    await supabase.auth.signOut();
    navigate('/sign-in');
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6">Your estates</h1>

      {estates === undefined ? null : estates.length === 0 ? (
        <Notice tone="neutral" icon="users">
          You are not part of an estate yet. Start one, or join with the invitation code a family member sent you.
        </Notice>
      ) : (
        <ul className="panel mb-6 px-4">
          {estates.map((e) => (
            <li key={e.id}>
              <Link to={`/e/${e.id}`} className="flex min-h-16 items-center gap-3 border-b border-line py-3 last:border-0">
                <Icon name="home" className="text-action" />
                <span className="flex-1">
                  <span className="block font-bold">{e.name}</span>
                  <span className="text-[0.92rem] text-ink-soft">You are {ROLE_LABELS[e.my_role].toLowerCase()}</span>
                </span>
                <Icon name="forward" className="text-ink-soft" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/join" className="btn btn-secondary"><Icon name="users" /> Join with a code</Link>
        <button type="button" className="btn btn-secondary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          <Icon name="plus" /> Start a new estate
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="panel mt-5 p-5">
          {!isOnline && <Notice tone="attention" icon="cloudOff">Starting an estate needs a connection.</Notice>}
          <Field label="Estate name" htmlFor="ename" hint='For example, "Mom’s house" or "Estate of Janice Baron".'>
            <input id="ename" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Name of the person who passed (optional)" htmlFor="dname">
            <input id="dname" className="input" value={decedent} onChange={(e) => setDecedent(e.target.value)} />
          </Field>
          <Field label="Your role" htmlFor="role" hint="The executor is the person the will or the court named to handle the estate. If that is not you, choose administrator and invite the executor.">
            <select id="role" className="input" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="ADMINISTRATOR">Administrator (I'm organizing the app)</option>
              <option value="EXECUTOR">Executor</option>
            </select>
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy || !isOnline || !name.trim()}>Start the estate</button>
          <ErrorText error={error} />
        </form>
      )}

      <button type="button" className="btn btn-quiet mt-10" onClick={signOut}><Icon name="lock" size={18} /> Sign out</button>
    </main>
  );
}
