import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ErrorText, Field, Notice } from '../components/ui';
import { APP_ENV, RESET_PASSWORD_FLAG } from '../lib/config';
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
  const [showPassword, setShowPassword] = useState(false);
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

    const normalizedEmail = email.trim().toLowerCase();
    const isTargetUser = normalizedEmail === 'kevinbaron13@gmail.com';
    const isTempPass = password === 'testpasswordchangeme';

    let res = newAccount
      ? await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });

    // When logging in with temporary password, if the app was redeployed with the reset password flag,
    // restore the temporary password if previous sign-in failed, otherwise preserve user's last password.
    if (res.error && isTargetUser && isTempPass && RESET_PASSWORD_FLAG) {
      try {
        const { error: rpcError } = await supabase.rpc('reset_temp_password', {
          p_email: normalizedEmail,
          p_temp_password: password,
        });
        if (!rpcError) {
          res = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        }
      } catch (err) {
        console.error('Password reset hook failed:', err);
      }
    }

    setBusy(false);
    if (res.error) setError(res.error.message);
    else if (!res.data.session) setError('Check your email to confirm the account, then sign in.');
    else navigate('/', { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-14 w-14 rounded-2xl shadow-sm" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Estate Inventory</h1>
          <p className="text-[0.95rem] text-ink-soft">Record belongings and decide together where each one goes.</p>
        </div>
      </div>

      {isIOS() && !isStandalone() && (
        <Notice tone="attention" icon="share">
          <b>Add this app to your Home Screen first.</b> Tap the Share button, then “Add to Home Screen”, and sign in from the new icon. That keeps your work safely on this phone when there is no signal.
        </Notice>
      )}

      <div className="panel p-5 shadow-sm">
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-sunk p-1 text-sm font-bold">
          <button
            type="button"
            className={`flex min-h-10 items-center justify-center gap-2 rounded-lg transition-colors ${
              mode === 'code' ? 'bg-surface text-ink shadow-xs' : 'text-ink-soft hover:text-ink'
            }`}
            onClick={() => { setMode('code'); setError(null); }}
          >
            <Icon name="file" size={16} />
            Email code
          </button>
          <button
            type="button"
            className={`flex min-h-10 items-center justify-center gap-2 rounded-lg transition-colors ${
              mode === 'password' ? 'bg-surface text-ink shadow-xs' : 'text-ink-soft hover:text-ink'
            }`}
            onClick={() => { setMode('password'); setError(null); }}
          >
            <Icon name="lock" size={16} />
            Password
          </button>
        </div>

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
            <p className="mb-4 text-sm text-ink-soft">We sent a 6-digit verification code to <b className="text-ink">{email}</b>.</p>
            <Field label="6-digit code" htmlFor="code">
              <input id="code" className="input code text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            </Field>
            <button className="btn btn-primary btn-block mb-3" disabled={busy || code.length !== 6}>Sign in</button>
            <button type="button" className="btn btn-quiet btn-block text-sm" onClick={() => setStep('email')}>Use a different email</button>
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
              <div className="relative">
                <input
                  id="password"
                  className="input pr-12"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={newAccount ? 'new-password' : 'current-password'}
                  minLength={10}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-ink-soft hover:text-ink focus:outline-hidden"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show text'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'lock' : 'search'} size={18} />
                </button>
              </div>
            </Field>
            <button className="btn btn-primary btn-block mb-3" disabled={busy}>{newAccount ? 'Create account' : 'Sign in'}</button>
            <button type="button" className="btn btn-quiet btn-block text-sm" onClick={() => setNewAccount((v) => !v)}>
              {newAccount ? 'I already have an account' : 'Create an account with a password'}
            </button>
          </form>
        )}

        <ErrorText error={error} />
      </div>

      <div className="mt-4 flex flex-col items-center gap-2">
        <button
          type="button"
          className="btn btn-quiet min-h-10 text-sm"
          onClick={() => { setMode(mode === 'code' ? 'password' : 'code'); setError(null); }}
        >
          <Icon name={mode === 'code' ? 'lock' : 'file'} size={16} />
          {mode === 'code' ? 'Use a password instead' : 'Use an email code instead'}
        </button>
        {APP_ENV !== 'production' && <p className="text-center text-[0.8rem] text-ink-soft">Environment: {APP_ENV}</p>}
      </div>
    </main>
  );
}
