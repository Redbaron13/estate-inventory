import { useEffect, useState } from 'react';
import { Dialog, ErrorText } from './ui';
import { Icon } from './Icon';
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
  useEffect(() => {
    const offer = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', offer); window.removeEventListener('appinstalled', done); };
  }, []);
  async function install() {
    if (!prompt) { setOpen(true); return; }
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === 'accepted') setInstalled(true);
      setPrompt(null);
    } catch { setError('Open the browser menu and choose Install app or Add to Home Screen.'); }
  }
  return <section className="panel mb-5 p-4" aria-labelledby="install-heading">
    <h2 id="install-heading" className="mb-2">Use it as an app</h2>
    <p className="mb-3 text-ink-soft">Keep Estate Inventory on your computer or phone. It opens in its own window and keeps your saved inventory available offline.</p>
    <button type="button" className="btn btn-secondary" onClick={() => void install()}>{<Icon name="download" />}{installed ? 'App installed: device help' : 'Install on this device'}</button>
    <ErrorText error={error} />
    <Dialog open={open} onClose={() => setOpen(false)} title="Install Estate Inventory">
      <ol className="list-decimal space-y-3 pl-5">
        <li><b>iPhone or iPad:</b> open this site in Safari, tap Share, then Add to Home Screen and Open as Web App if offered.</li>
        <li><b>Android:</b> open in Chrome, then choose Install app or Add to Home screen from the menu.</li>
        <li><b>Mac:</b> in Safari choose File, then Add to Dock. Chrome also offers Install in its menu.</li>
        <li><b>Windows or Linux:</b> open in Chrome or Edge and choose Install from the address bar or browser menu.</li>
      </ol>
      <p className="mt-4 text-ink-soft">Use the same account on each device. Let uploads finish before switching devices. An unsaved batch stays on the device where you captured it.</p>
    </Dialog>
  </section>;
}
