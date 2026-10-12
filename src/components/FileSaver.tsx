// Delivering a generated file (PDF, CSV, backup) to the person.
//
// saveFile() opens the share sheet where possible. On iPhone the share sheet
// only opens straight after a tap; when building the file took longer than
// that allows, this shows "Your file is ready" with a Save button, whose tap
// opens the share sheet, plus an Open link as a fallback.
import { useEffect, useState } from 'react';
import { saveFile, type SaveOutcome } from '../lib/files';
import { Icon } from './Icon';

function describe(outcome: SaveOutcome, file: File): string | null {
  if (outcome === 'shared') return `${file.name} is saved.`;
  if (outcome === 'downloaded') return `${file.name} is in your downloads.`;
  return null;
}

function sizeLabel(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function FileReady({ file, estateId, onDone }: { file: File; estateId?: string; onDone: (o: SaveOutcome) => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="panel mt-3 p-4" role="status">
      <p className="mb-3"><b>Your file is ready.</b> {file.name} ({sizeLabel(file.size)})</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void saveFile(file, estateId).then((o) => { if (o !== 'needs-tap') onDone(o); })}
        >
          <Icon name="share" size={18} /> Save or share
        </button>
        <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">
          <Icon name="eye" size={18} /> Open it
        </a>
      </div>
    </div>
  );
}

/** `deliver(file)` hands a file over; render `panel` near the button that made it. */
export function useFileSaver(estateId?: string) {
  const [ready, setReady] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function deliver(file: File): Promise<SaveOutcome> {
    setStatus(null);
    const outcome = await saveFile(file, estateId);
    if (outcome === 'needs-tap') {
      setReady(file);
    } else {
      setReady(null);
      setStatus(describe(outcome, file));
    }
    return outcome;
  }

  const panel = ready ? (
    <FileReady
      key={`${ready.name}-${ready.size}-${ready.lastModified}`}
      file={ready}
      estateId={estateId}
      onDone={(o) => { setStatus(describe(o, ready)); setReady(null); }}
    />
  ) : status ? (
    <p className="mt-3 text-ink-soft" role="status">{status}</p>
  ) : null;

  return { deliver, panel };
}
