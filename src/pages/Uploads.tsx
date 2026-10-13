import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { ActionDialog, EmptyState, Notice, PageHeader, ToneChip } from '../components/ui';
import { API_URL, APP_ENV, APP_VERSION } from '../lib/config';
import { db } from '../lib/db';
import type { Diagnostic } from '../lib/diagnostics';
import { useEstateId, useSyncState } from '../lib/hooks';
import { discardOp, reapplyOnLatest, retryOp } from '../lib/outbox';
import { syncNow } from '../lib/sync';

export default function Uploads() {
  const estateId = useEstateId();
  const sync = useSyncState();
  const ops = useLiveQuery(() => db.outbox.where('estate_id').equals(estateId).sortBy('seq'), [estateId]) ?? [];
  const drafts = useLiveQuery(() => db.drafts.where('estate_id').equals(estateId).toArray(), [estateId]) ?? [];
  const diagnosticRow = useLiveQuery(() => db.meta.get('diagnostics'), []);
  const problems = ops.filter((o) => o.status !== 'pending');
  const pending = ops.filter((o) => o.status === 'pending');
  const [discardSeq, setDiscardSeq] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const diagnostics = Array.isArray(diagnosticRow?.value) ? diagnosticRow.value as Diagnostic[] : [];
  let apiHost = 'Unavailable';
  try { apiHost = new URL(API_URL).host; } catch { /* show unavailable configuration */ }

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({
        app: { version: APP_VERSION, environment: APP_ENV, apiHost },
        sync: { online: sync.online, syncing: sync.syncing, pending: sync.pending, problems: sync.problems, lastSyncAt: sync.lastSyncAt },
        events: diagnostics,
      }, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <PageHeader title="Upload queue" back={`/e/${estateId}`} />
      <p className="mb-4 text-ink-soft">Changes are saved on this phone first, then sent in order. Nothing leaves this list until the server confirms it.</p>
      {sync.online ? (
        <button type="button" className="btn btn-secondary btn-block mb-6" onClick={() => void syncNow()} disabled={sync.syncing}>
          <Icon name="refresh" className={sync.syncing ? 'animate-spin' : ''} /> {sync.syncing ? 'Uploading…' : 'Upload now'}
        </button>
      ) : (
        <Notice tone="attention" icon="cloudOff">You're offline. Everything here uploads automatically when you have signal and the app is open.</Notice>
      )}
      {sync.needsSignIn && <Notice tone="attention" icon="lock">Your sign-in expired. Sign in again to upload; nothing here is lost.</Notice>}

      {problems.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3">Needs attention</h2>
          <ul className="space-y-3">
            {problems.map((o) => {
              const fields = (o.error_details as { fields?: string[] } | undefined)?.fields;
              return (
                <li key={o.seq} className="panel p-4">
                  <p className="mb-1 font-bold">{o.label}</p>
                  <p className="mb-3">{o.last_error}{fields?.length && fields[0] !== 'version' ? ` Changed by someone else: ${fields.join(', ')}.` : ''}</p>
                  <div className="flex flex-wrap gap-2">
                    {o.status === 'conflict' && !!(o.error_details as { current?: unknown } | undefined)?.current && (
                      <button type="button" className="btn btn-primary" onClick={() => void reapplyOnLatest(o.seq!)}>Use my change on the latest version</button>
                    )}
                    <button type="button" className="btn btn-secondary" onClick={() => void retryOp(o.seq!)}>Try again</button>
                    <button type="button" className="btn btn-quiet" onClick={() => setDiscardSeq(o.seq!)}>Remove it</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {drafts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3">Waiting for an item number</h2>
          <p className="mb-3 text-ink-soft">These were saved while this phone had no numbers left. They are numbered at the next sync.</p>
          <ul className="divide-y divide-line border-y border-line">
            {drafts.map((d) => <li key={d.id} className="py-2.5">{String(d.payload.title ?? 'Item')} <span className="text-ink-soft">({d.photos.length} photo{d.photos.length === 1 ? '' : 's'})</span></li>)}
          </ul>
        </section>
      )}

      {pending.length > 0 ? (
        <section>
          <h2 className="mb-3">Waiting to upload ({pending.length})</h2>
          <ul className="divide-y divide-line border-y border-line">
            {pending.map((o) => (
              <li key={o.seq} className="flex items-center justify-between gap-3 py-2.5">
                <span>{o.label}</span>
                {o.attempts > 0 ? <ToneChip tone="attention" icon="refresh">Retrying</ToneChip> : <ToneChip tone="neutral" icon="cloud">Queued</ToneChip>}
              </li>
            ))}
          </ul>
        </section>
      ) : problems.length === 0 && drafts.length === 0 ? (
        <EmptyState icon="check" title="Everything is uploaded">
          {sync.lastSyncAt ? `Last synced ${new Date(sync.lastSyncAt).toLocaleTimeString()}.` : ''}
        </EmptyState>
      ) : null}
      <details className="panel mt-8 p-4">
        <summary className="cursor-pointer font-bold">Technical details for troubleshooting</summary>
        <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-soft">App version</dt><dd className="code">{APP_VERSION}</dd>
          <dt className="text-ink-soft">Environment</dt><dd>{APP_ENV}</dd>
          <dt className="text-ink-soft">API host</dt><dd className="code">{apiHost}</dd>
          <dt className="text-ink-soft">Connection</dt><dd>{sync.online ? 'Online' : 'Offline'}</dd>
          <dt className="text-ink-soft">Last sync</dt><dd>{sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'Not yet synced'}</dd>
        </dl>
        <h2 className="mb-2 mt-4 text-base">Recent events</h2>
        {diagnostics.length ? (
          <ol className="mb-3 space-y-2">
            {diagnostics.slice(-10).reverse().map((event, i) => (
              <li key={`${event.at}-${event.code}-${i}`} className="border-l-2 border-line pl-3">
                <p className="font-bold">{event.code} <span className="font-normal text-ink-soft">· {event.area}</span></p>
                <p>{event.message}</p>
                <time className="text-xs text-ink-soft" dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        ) : <p className="mb-3 text-ink-soft">No troubleshooting events have been recorded.</p>}
        <button type="button" className="btn btn-secondary" onClick={() => void copyDiagnostics()} disabled={!navigator.clipboard}>
          <Icon name="copy" size={18} /> {copied ? 'Copied' : 'Copy troubleshooting details'}
        </button>
      </details>
      <ActionDialog
        open={discardSeq !== null}
        onClose={() => setDiscardSeq(null)}
        title="Remove this change?"
        confirmLabel="Remove change"
        danger
        onConfirm={() => discardSeq === null ? undefined : discardOp(discardSeq)}
      >
        The server refused it, so it never became part of the shared record.
      </ActionDialog>
    </div>
  );
}
