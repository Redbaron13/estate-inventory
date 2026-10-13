import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  STATUS_LABELS, STATUS_TONE, type ItemStatus, type Media, type Tone,
} from '../../supabase/functions/_shared/domain.ts';
import { useBlobUrl, usePending } from '../lib/hooks';
import { db } from '../lib/db';
import { supabase } from '../lib/supabase';
import { MEDIA_BUCKET } from '../lib/config';
import { Icon, type IconName } from './Icon';

const TONE_ICON: Record<Tone, IconName> = {
  neutral: 'tag', attention: 'alert', progress: 'refresh', done: 'check', warning: 'alert',
};

export function ToneChip({ tone, icon, children }: { tone: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`chip tone-${tone}`}>
      <Icon name={icon ?? TONE_ICON[tone]} size={15} />
      {children}
    </span>
  );
}

const STATUS_ICON: Record<ItemStatus, IconName> = {
  DISCOVERED: 'tag', NEEDS_IDENTIFICATION: 'search', NEEDS_VALUATION: 'dollar', NEEDS_DECISION: 'scale',
  UP_FOR_GRABS: 'hand', CLAIM_REQUESTED: 'hand', ASSIGNED: 'gift', APPROVAL_PENDING: 'history',
  APPROVED_FOR_SALE: 'dollar', APPROVED_FOR_DONATION: 'gift', APPROVED_FOR_DISPOSAL: 'trash',
  SOLD: 'check', DONATED: 'check', DISTRIBUTED: 'check', DISPOSED: 'check', MISSING: 'alert', ON_HOLD: 'pin', MERGED: 'copy',
};

export function StatusChip({ status }: { status: ItemStatus }) {
  return <ToneChip tone={STATUS_TONE[status]} icon={STATUS_ICON[status]}>{STATUS_LABELS[status]}</ToneChip>;
}

export function CodeTag({ code, large = false, swing = false }: { code: string; large?: boolean; swing?: boolean }) {
  return (
    <span className={`tag ${swing ? 'tag-swing' : ''}`} style={{ fontSize: large ? '1.35rem' : '0.86rem' }} aria-label={`Code ${code.split('').join(' ')}`}>
      {code}
    </span>
  );
}

export function PageHeader({ title, back, children }: { title: string; back?: string | true; children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="mb-5 flex items-start gap-2">
      {back && (
        <button
          type="button"
          className="btn btn-quiet -ml-2 min-h-11 px-2"
          onClick={() => (back === true ? navigate(-1) : navigate(back))}
        >
          <Icon name="back" />
          <span className="sr-only sm:not-sr-only">Back</span>
        </button>
      )}
      <div className="min-w-0 flex-1 pt-1">
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="text-ink-soft"><Icon name={icon} size={36} /></span>
      <h2>{title}</h2>
      {children && <p className="max-w-[34ch] text-ink-soft">{children}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = 'progress', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`tone-${tone} mb-4 flex gap-3 rounded-xl px-4 py-3`} role={tone === 'warning' ? 'alert' : 'status'}>
      <Icon name={icon ?? TONE_ICON[tone]} className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** "Not yet uploaded" marker, shown on anything still waiting in the queue. */
export function PendingMarker({ entityId }: { entityId: string }) {
  const ops = usePending(entityId);
  if (!ops.length) return null;
  const failed = ops.some((o) => o.status !== 'pending');
  return failed ? (
    <ToneChip tone="warning" icon="alert">Needs attention</ToneChip>
  ) : (
    <ToneChip tone="attention" icon="cloudOff">Not yet uploaded</ToneChip>
  );
}

async function fetchAndStore(estateId: string, path: string, sha: string, role: 'thumb' | 'full') {
  const { data } = await supabase.storage.from(MEDIA_BUCKET).download(path);
  if (!data) return null;
  await db.blobs.put({ sha256: sha, estate_id: estateId, blob: data, mime_type: data.type || 'image/jpeg', role, uploaded: true, created_at: new Date().toISOString() });
  return data;
}

export function Thumb({ media, size = 64, full = false, className = '' }: { media: Media | null | undefined; size?: number; full?: boolean; className?: string }) {
  const sha = media ? (full ? media.sha256 : media.thumb_sha256 ?? media.sha256) : null;
  const path = media ? (full ? media.storage_path : media.thumb_path ?? media.storage_path) : null;
  const url = useBlobUrl(sha, media && path && sha ? () => fetchAndStore(media.estate_id, path, sha, full ? 'full' : 'thumb') : undefined);
  const style = full ? undefined : { width: size, height: size };
  if (!media || !url) {
    return (
      <div className={`flex items-center justify-center rounded-lg bg-sunk text-ink-soft ${className}`} style={style} aria-label="No photo">
        <Icon name="camera" size={Math.min(28, size / 2.5)} />
      </div>
    );
  }
  return <img src={url} alt="" className={`rounded-lg object-cover ${className}`} style={style} loading="lazy" />;
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby={titleId}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
    >
      <div className="max-h-[85dvh] overflow-y-auto p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-quiet -mr-2 -mt-2 min-h-11" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}

export function ActionDialog({
  open, onClose, title, children, confirmLabel, inputLabel, inputHint, onConfirm, danger = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  inputLabel?: string;
  inputHint?: string;
  onConfirm: (value: string) => void | Promise<void>;
  danger?: boolean;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  useEffect(() => {
    if (open) {
      setValue('');
      setError(null);
      setBusy(false);
    }
  }, [open]);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(value.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message || 'That could not be completed. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {children && <div className="mb-4">{children}</div>}
      {inputLabel && (
        <Field label={inputLabel} htmlFor={inputId} hint={inputHint}>
          <textarea id={inputId} className="input" value={value} onChange={(e) => setValue(e.target.value)} required />
        </Field>
      )}
      <ErrorText error={error} />
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-quiet flex-1" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'} flex-1`} onClick={() => void confirm()} disabled={busy || (!!inputLabel && !value.trim())}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function LinkRow({ to, icon, title, detail, count }: { to: string; icon: IconName; title: string; detail?: string; count?: number }) {
  return (
    <Link to={to} className="group flex min-h-16 items-center gap-4 border-b border-line px-2 py-3.5 last:border-0 hover:bg-sunk/40 active:bg-sunk/60 transition-colors rounded-lg">
      <span className="text-action transition-transform duration-150 group-hover:scale-105"><Icon name={icon} size={26} /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{title}</span>
        {detail && <span className="block text-[0.92rem] text-ink-soft">{detail}</span>}
      </span>
      {count !== undefined && <span className="tabular rounded-full bg-sunk px-2.5 py-0.5 font-bold shadow-2xs">{count}</span>}
      <Icon name="forward" className="text-ink-soft transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function Spinner({ label = 'Working' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-soft" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </span>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <p className="mt-2 font-bold text-[var(--warning-ink)]" role="alert">{error}</p>;
}
