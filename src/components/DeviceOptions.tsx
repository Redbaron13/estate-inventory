import { useEffect, useState } from 'react';
const KEY = 'estate-device-options';
interface Options { compact: boolean; hints: boolean }
function read(): Options {
  try { return { compact: false, hints: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { compact: false, hints: true }; }
}
export function applyDeviceOptions() {
  const options = read();
  document.documentElement.classList.toggle('compact-view', options.compact);
  document.documentElement.classList.toggle('hide-hints', !options.hints);
}
export function DeviceOptions() {
  const [options, setOptions] = useState<Options>(read);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(options)); } catch { /* Private mode may deny storage; the current view still works. */ }
    document.documentElement.classList.toggle('compact-view', options.compact);
    document.documentElement.classList.toggle('hide-hints', !options.hints);
  }, [options]);
  return <section className="panel mb-5 p-4" aria-labelledby="device-heading">
    <h2 id="device-heading" className="mb-3">Make this device comfortable</h2>
    <label className="mb-4 flex gap-3"><input className="h-6 w-6" type="checkbox" checked={options.hints} onChange={e => setOptions({ ...options, hints: e.target.checked })} /><span>Show workflow hints</span></label>
    <label className="flex gap-3"><input className="h-6 w-6" type="checkbox" checked={options.compact} onChange={e => setOptions({ ...options, compact: e.target.checked })} /><span>Compact inventory rows</span></label>
    <p className="mt-3 text-ink-soft">Family and settings also lets you choose larger text, simpler screens, permissions, approval rules, and open or sealed family choices. Places and labels lets you name your own rooms and boxes.</p>
  </section>;
}
