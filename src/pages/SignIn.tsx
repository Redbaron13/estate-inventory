import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ErrorText, Field, Notice } from '../components/ui';
import { APP_ENV } from '../lib/config';
import { supabase } from '../lib/supabase';

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function SignIn() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'code' | 'password'>('code');
  const [step, setStep] = useState<'email' | 'verify'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [newAccount, setNewAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) setError(error.message.includes('rate') ? 'Too many codes requested. Wait a few minutes and try again.' : error.message);
    else setStep('verify');
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError('That code did not work. Check the newest email and try again.');
    else navigate('/', { replace: true });
  }

  async function withPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = newAccount
      ? await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (res.error) setError(res.error.message);
    else if (!res.data.session) setError('Check your email to confirm the account, then sign in.');
    else navigate('/', { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-14 w-14 rounded-2xl" />
        <div>
          <h1>Estate Inventory</h1>
          <p className="text-ink-soft">Record belongings and decide together where each one goes.</p>
        </div>
      </div>

      {isIOS() && !isStandalone() && (
        <Notice tone="attention" icon="share">
          <b>Add this app to your Home Screen first.</b> Tap the Share button, then “Add to Home Screen”, and sign in from the new icon. That keeps your work safely on this phone when there is no signal.
        </Notice>
      )}

      {mode === 'code' && step === 'email' && (
        <form onSubmit={sendCode}>
          <Field label="Your email address" htmlFor="email" hint="We'll email you a 6-digit code. No password needed.">
            <input id="email" className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy || !email}>Email me a code</button>
        </form>
      )}

      {mode === 'code' && step === 'verify' && (
        <form onSubmit={verify}>
          <p className="mb-4">We sent a code to <b>{email}</b>.</p>
          <Field label="6-digit code" htmlFor="code">
            <input id="code" className="input code text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
          <button className="btn btn-primary btn-block mb-3" disabled={busy || code.length !== 6}>Sign in</button>
          <button type="button" className="btn btn-quiet btn-block" onClick={() => setStep('email')}>Use a different email</button>
        </form>
      )}

      {mode === 'password' && (
        <form onSubmit={withPassword}>
          {newAccount && (
            <Field label="Your name" htmlFor="name" hint="Shown to your family next to your choices.">
              <input id="name" className="input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <Field label="Email" htmlFor="pemail">
            <input id="pemail" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password" hint={newAccount ? 'At least 10 characters.' : undefined}>
            <input id="password" className="input" type="password" autoComplete={newAccount ? 'new-password' : 'current-password'} minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn btn-primary btn-block mb-3" disabled={busy}>{newAccount ? 'Create account' : 'Sign in'}</button>
          <button type="button" className="btn btn-quiet btn-block" onClick={() => setNewAccount((v) => !v)}>
            {newAccount ? 'I already have an account' : 'Create an account with a password'}
          </button>
        </form>
      )}

      <ErrorText error={error} />

      <button type="button" className="btn btn-quiet mt-6" onClick={() => { setMode(mode === 'code' ? 'password' : 'code'); setError(null); }}>
        <Icon name={mode === 'code' ? 'lock' : 'file'} size={18} />
        {mode === 'code' ? 'Use a password instead' : 'Use an email code instead'}
      </button>
      {APP_ENV !== 'production' && <p className="mt-6 text-center text-[0.85rem] text-ink-soft">Environment: {APP_ENV}</p>}
    </main>
  );
}
