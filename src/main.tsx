import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource/atkinson-hyperlegible-mono/500.css';
import '@fontsource/atkinson-hyperlegible-mono/700.css';
import './index.css';
import { supabase } from './lib/supabase';
import { initializeAccountScope, accountMatches } from './lib/account-scope';


async function openAccount() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error('Your sign-in could not be checked. Reload to try again.');
  initializeAccountScope(data.session?.user.id ?? null);
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!accountMatches(session?.user.id ?? null)) {
      // Do not leave an old account's screen visible while the new page loads.
      document.getElementById('root')!.replaceChildren();
      window.location.replace(session ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}sign-in`);
    }
  });
  const legacy = data.session && (!indexedDB.databases || (await indexedDB.databases()).some(db => db.name === 'estate-inventory'));
  const [{ default: App }, { ErrorBoundary }] = await Promise.all([import('./App'), import('./components/ErrorBoundary')]);
  createRoot(document.getElementById('root')!).render(
    <StrictMode><ErrorBoundary>
      {legacy && <aside role="status" className="mx-auto max-w-2xl p-4 text-sm">
        Earlier device data has been kept separately for safety. Uploaded items will sync into this account.
        If you had unsent items or a batch in the earlier app, do not clear browser data. Ask your administrator to help recover that work before starting it again.
      </aside>}
      <App /></ErrorBoundary></StrictMode>,
  );
}
void openAccount().catch(() => {
  const root = document.getElementById('root')!;
  root.textContent = 'Your sign-in or local storage could not open. Your saved work is kept. Reload the app to try again.';
});
