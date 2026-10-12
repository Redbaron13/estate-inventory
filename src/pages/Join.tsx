import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorText, Field, Notice, PageHeader } from '../components/ui';
import { online } from '../lib/actions';
import { useOnline } from '../lib/hooks';
import { syncNow } from '../lib/sync';

export default function Join() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOnline = useOnline();
  const navigate = useNavigate();

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const estate = await online.acceptInvite(code);
      await syncNow();
      navigate(`/e/${estate.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <PageHeader title="Join an estate" back="/estates" />
      {!isOnline && <Notice tone="attention" icon="cloudOff">Joining needs a connection.</Notice>}
      <form onSubmit={join}>
        <Field label="Invitation code" htmlFor="code" hint="The code from the message your family member sent. Sign in with the email address the invitation was sent to.">
          <input id="code" className="input code text-center text-lg uppercase" autoCapitalize="characters" autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !isOnline || code.replace(/[^0-9a-f]/gi, '').length < 20}>Join</button>
        <ErrorText error={error} />
      </form>
    </main>
  );
}
