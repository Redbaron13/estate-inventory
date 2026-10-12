import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEstateData, useEstateId, useMeta, useSyncState } from '../lib/hooks';
import { syncNow } from '../lib/sync';
import { Dialog } from './ui';
import { Icon, type IconName } from './Icon';

function SyncPill({ estateId }: { estateId: string }) {
  const s = useSyncState();
  const navigate = useNavigate();
  let tone = 'tone-done', icon: IconName = 'check', text = 'All saved';
  if (s.needsSignIn) { tone = 'tone-attention'; icon = 'lock'; text = 'Sign in to upload'; }
  else if (s.problems) { tone = 'tone-warning'; icon = 'alert'; text = `${s.problems} need${s.problems === 1 ? 's' : ''} attention`; }
  else if (!s.online) { tone = 'tone-attention'; icon = 'cloudOff'; text = s.pending ? `Offline: ${s.pending} waiting` : 'Offline'; }
  else if (s.syncing) { tone = 'tone-progress'; icon = 'refresh'; text = 'Saving…'; }
  else if (s.pending) { tone = 'tone-attention'; icon = 'cloud'; text = `${s.pending} to upload`; }
  return (
    <button
      type="button"
      className={`chip ${tone} min-h-9 shrink-0 cursor-pointer`}
      title={!s.online ? 'Saved on this phone. Uploads when you have signal.' : undefined}
      onClick={() => (s.needsSignIn ? navigate('/sign-in') : s.problems || s.pending ? navigate(`/e/${estateId}/uploads`) : void syncNow())}
      aria-live="polite"
    >
      <Icon name={icon} size={16} className={s.syncing ? 'animate-spin' : ''} />
      {text}
    </button>
  );
}

function HelpButton({ estateId }: { estateId: string }) {
  const [open, setOpen] = useState(false);
  const data = useEstateData(estateId);
  const name = data?.estate?.help_contact_name;
  const phone = data?.estate?.help_contact_phone;
  return (
    <>
      <button type="button" className="btn btn-quiet min-h-11 px-2" onClick={() => setOpen(true)}>
        <Icon name="help" />
        <span className="sr-only">Help</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Need help?">
        {phone ? (
          <a className="btn btn-primary btn-block mb-5" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
            <Icon name="phone" /> Call {name || 'for help'}
          </a>
        ) : (
          <p className="mb-5 text-ink-soft">An administrator can add a help contact in Family &amp; settings.</p>
        )}
        <ul className="space-y-3">
          <li><b>Everything saves by itself.</b> If you lose signal, your work stays on this phone and uploads later.</li>
          <li><b>Nothing can be deleted.</b> Mistakes are fixed by adding a correction, so you can't break anything.</li>
          <li><b>Photograph first.</b> You can add details later.</li>
          <li><b>Use the voice button on your keyboard</b> to speak descriptions instead of typing.</li>
        </ul>
      </Dialog>
    </>
  );
}

function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="tone-progress flex items-center gap-3 px-4 py-2 text-[0.95rem]" role="status">
      <Icon name="refresh" size={18} />
      <span className="flex-1">A new version is ready. Your saved work is kept.</span>
      <button type="button" className="btn btn-primary min-h-10 px-3 py-1" onClick={() => void updateServiceWorker(true)}>Restart app</button>
    </div>
  );
}

const TABS: { to: string; icon: IconName; label: string; end?: boolean }[] = [
  { to: '', icon: 'home', label: 'Home', end: true },
  { to: 'add', icon: 'plus', label: 'Add item' },
  { to: 'items', icon: 'list', label: 'Inventory' },
  { to: 'decisions', icon: 'scale', label: 'Decisions' },
  { to: 'more', icon: 'more', label: 'More' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const alert = useMeta<unknown>(`ledger_alert:${estateId}`, null);
  return (
    <div className="flex min-h-dvh flex-col">
      <UpdateBanner />
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2">
          <Link to="/estates" className="min-w-0 flex-1 truncate font-bold" title="Switch estate">
            {data?.estate?.name ?? 'Estate'}
          </Link>
          <SyncPill estateId={estateId} />
          <HelpButton estateId={estateId} />
        </div>
        {!!alert && (
          <Link to={`/e/${estateId}/backup`} className="tone-warning block px-4 py-2 text-center font-bold">
            The shared history does not match what this phone recorded. Tap for details.
          </Link>
        )}
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-5">{children}</main>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface" aria-label="Main">
        <ul className="mx-auto grid max-w-2xl grid-cols-5">
          {TABS.map((t) => (
            <li key={t.label}>
              <NavLink
                to={`/e/${estateId}${t.to ? `/${t.to}` : ''}`}
                end={t.end}
                className={({ isActive }) =>
                  `flex min-h-16 flex-col items-center justify-center gap-0.5 text-[0.78rem] font-bold ${isActive ? 'text-action' : 'text-ink-soft'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`flex h-8 w-12 items-center justify-center rounded-full ${isActive ? 'bg-sunk' : ''}`}>
                      <Icon name={t.icon} size={t.icon === 'plus' ? 26 : 23} />
                    </span>
                    {t.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
