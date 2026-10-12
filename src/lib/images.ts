// Photos are resized on the phone before saving: large enough to read a
// maker's mark (2048 px), small enough to keep many on the phone offline.
// Each file is named by its SHA-256 fingerprint.
import { sha256Hex } from '../../supabase/functions/_shared/ledger.ts';

export interface PreparedPhoto {
  full: Blob;
  thumb: Blob;
  sha256: string;
  thumb_sha256: string;
  mime_type: string;
  width: number;
  height: number;
  byte_size: number;
}

const FULL_MAX = 2048;
const THUMB_MAX = 400;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Fallback for browsers that cannot decode via createImageBitmap.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

function dims(src: ImageBitmap | HTMLImageElement) {
  return 'naturalWidth' in src ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height };
}

async function render(src: ImageBitmap | HTMLImageElement, max: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const { w, h } = dims(src);
  const scale = Math.min(1, max / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, tw, th);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo.'))), 'image/jpeg', quality),
  );
  return { blob, w: tw, h: th };
}

export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const src = await decode(file);
  const full = await render(src, FULL_MAX, 0.82);
  const thumb = await render(src, THUMB_MAX, 0.72);
  if ('close' in src) src.close();
  const [sha256, thumb_sha256] = await Promise.all([sha256Hex(await full.blob.arrayBuffer()), sha256Hex(await thumb.blob.arrayBuffer())]);
  return {
    full: full.blob, thumb: thumb.blob, sha256, thumb_sha256, mime_type: 'image/jpeg',
    width: full.w, height: full.h, byte_size: full.blob.size,
  };
}

/** PDFs and other documents are stored as-is. */
export async function prepareDocument(file: File): Promise<{ blob: Blob; sha256: string; mime_type: string; byte_size: number }> {
  const sha256 = await sha256Hex(await file.arrayBuffer());
  return { blob: file, sha256, mime_type: file.type || 'application/pdf', byte_size: file.size };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
