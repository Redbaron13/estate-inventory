// Hand a file to the person: share sheet where available (iPhone: Save to
// Files > iCloud Drive), otherwise a normal download.
import { setMeta } from './db';

export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled' | 'needs-tap';

/** Opens the share sheet where possible (iPhone: Save to Files > iCloud Drive), otherwise downloads. */
export async function saveFile(file: File, estateId?: string): Promise<SaveOutcome> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      if (estateId) await setMeta(`last_backup:${estateId}`, new Date().toISOString());
      return 'shared';
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'AbortError') return 'cancelled';
      // iPhones open the share sheet only straight after a tap. If preparing
      // the file took too long, ask for one more tap rather than falling back
      // to a download, which an installed iPhone app silently ignores.
      if (name === 'NotAllowedError') return 'needs-tap';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (estateId) await setMeta(`last_backup:${estateId}`, new Date().toISOString());
  return 'downloaded';
}

export function blobFile(blob: Blob, name: string, type: string): File {
  return new File([blob], name, { type });
}
