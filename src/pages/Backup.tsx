import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Icon } from '../components/Icon';
import { ErrorText, Notice, PageHeader, Spinner } from '../components/ui';
import { buildBackup, saveFile } from '../lib/backup';
import { db, setMeta } from '../lib/db';
import { useEstateData, useEstateId, useMeta, useOnline } from '../lib/hooks';
import { syncNow } from '../lib/sync';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function Backup() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const online = useOnline();
  const lastBackup = useMeta<string | null>(`last_backup:${estateId}`, null);
  const alert = useMeta<{ at: string; problem?: { seq: number; reason: string }; witnessed?: { seq: number; hash: string; seen_at: string } } | null>(`ledger_alert:${estateId}`, null);
  const head = useMeta<{ estate_seq: number; hash: string } | null>(`head:${estateId}`, null);
  const witness = useLiveQuery(() => db.witnesses.where('estate_id').equals(estateId).last(), [estateId]);
  const [full, setFull] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!data) return null;

  async function prepare() {
    setError(null);
    setDone(null);
    setFile(null);
    try {
      setFile(await buildBackup(estateId, { includeFullPhotos: full, onProgress: setProgress }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  async function save() {
    if (!file) return;
    const outcome = await saveFile(file, estateId);
    if (outcome !== 'cancelled') {
      setDone(outcome === 'shared' ? 'Saved. Check that it appears in the Files app under iCloud Drive.' : 'Downloaded. Move it to iCloud Drive, Google Drive or a USB stick to keep it safe.');
      setFile(null);
    }
  }

  async function recheck() {
    // Clearing this phone's progress forces a full re-check from the first entry.
    await db.witnesses.where('estate_id').equals(estateId).delete();
    await setMeta(`ledger_alert:${estateId}`, null);
    await syncNow();
  }

  const mb = file ? (file.size / 1_048_576).toFixed(1) : null;

  return (
    <div>
      <PageHeader title="Save a copy" back={`/e/${estateId}/more`} />

      <section className="mb-8">
        <h2 className="mb-2">Save to iCloud or your own drive</h2>
        <p className="mb-4">
          Makes one file with every item's details, history, reports, a page you can read without the app, and the photos on this phone. Works without signal.
          {isIOS() && ' On the next screen choose “Save to Files”, then iCloud Drive.'}
        </p>
        <p className="mb-4 text-ink-soft">{lastBackup ? `Last saved ${new Date(lastBackup).toLocaleString()}.` : 'Not saved from this phone yet.'}</p>
        <label className="mb-4 flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-6 w-6" checked={full} onChange={(e) => setFull(e.target.checked)} />
          <span><b>Include full-size photos</b><br /><span className="text-ink-soft">Much bigger file. {online ? 'Photos not on this phone are downloaded first.' : 'Offline: only photos already on this phone are included.'} Without this, small photos of every item are still included.</span></span>
        </label>
        {!file ? (
          <button type="button" className="btn btn-primary btn-block" disabled={!!progress} onClick={() => void prepare()}>
            <Icon name="cloud" /> Prepare the backup file
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-block" onClick={() => void save()}>
            <Icon name="share" /> Save the file ({mb} MB)
          </button>
        )}
        {progress && <p className="mt-3"><Spinner label={progress} /></p>}
        <ErrorText error={error} />
        {done && <Notice tone="done" icon="check">{done}</Notice>}
      </section>

      <section className="mb-8" aria-labelledby="hist-h">
        <h2 id="hist-h" className="mb-2">History check</h2>
        {alert ? (
          <Notice tone="warning" icon="alert">
            <b>The shared history does not match what this phone saw before.</b> {alert.problem?.reason} (entry {alert.problem?.seq}).
            {alert.witnessed && <> This phone had verified up to entry {alert.witnessed.seq} on {new Date(alert.witnessed.seen_at).toLocaleString()}.</>}
            {' '}Tell the estate's administrator and executor, and keep your saved backups.
          </Notice>
        ) : (
          <p className="mb-3">
            Every change is chained to the one before it with a fingerprint. This phone checks each new change against the last fingerprint it verified, so history cannot be quietly rewritten, even by someone with full database access.
          </p>
        )}
        <dl className="mb-4 divide-y divide-line border-y border-line text-[0.95rem]">
          <div className="flex justify-between gap-3 py-2"><dt>Verified on this phone</dt><dd className="tabular">{witness ? `entry ${witness.seq}` : 'Not yet'}</dd></div>
          <div className="flex justify-between gap-3 py-2"><dt>Latest on the server</dt><dd className="tabular">{head ? `entry ${head.estate_seq}` : 'Unknown'}</dd></div>
          {witness && <div className="py-2"><dt className="mb-1">Fingerprint</dt><dd className="code break-all text-[0.85rem]">{witness.hash}</dd></div>}
        </dl>
        <button type="button" className="btn btn-secondary btn-block" disabled={!online} onClick={() => void recheck()}><Icon name="shield" /> Re-check the whole history</button>
      </section>

      <section aria-labelledby="safe-h">
        <h2 id="safe-h" className="mb-2">How your records are protected</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Nothing can be deleted or overwritten. Corrections are added as new records.</li>
          <li>Each photo is stored under its own fingerprint, so a file can never be swapped.</li>
          <li>Every night an encrypted copy of the database and all new photos goes to a separate, locked storage provider.</li>
          <li>Each month that copy is restored into a test database and checked automatically.</li>
          <li>Your phone keeps a full copy of the item records, and this page saves another to your own iCloud or drive.</li>
        </ul>
      </section>
    </div>
  );
}
