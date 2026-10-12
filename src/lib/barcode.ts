// Barcode and QR decoding that works offline. Uses the phone's built-in
// detector when it has one; otherwise a bundled decoder (zxing, compiled to
// WebAssembly and stored with the app, so it needs no connection).
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export interface Detected {
  value: string;
  format: string;
}

interface Detector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
}

const FORMATS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'data_matrix', 'codabar'];

let detectorPromise: Promise<Detector> | null = null;

export function getDetector(): Promise<Detector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const Native = (globalThis as any).BarcodeDetector;
      if (Native?.getSupportedFormats) {
        try {
          const supported: string[] = await Native.getSupportedFormats();
          const formats = FORMATS.filter((f) => supported.includes(f));
          if (formats.length) return new Native({ formats }) as Detector;
        } catch {
          // fall through to the bundled decoder
        }
      }
      const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
      prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
        },
      });
      return new BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector;
    })();
  }
  return detectorPromise;
}

/** Warm up the decoder (downloads nothing when offline; the file is already stored). */
export function preloadDetector() {
  void getDetector().catch(() => undefined);
}

export async function detectIn(source: ImageBitmapSource): Promise<Detected | null> {
  const detector = await getDetector();
  const found = await detector.detect(source);
  const best = found.find((f) => f.rawValue?.trim());
  return best ? { value: best.rawValue.trim(), format: best.format } : null;
}

/** Decode a barcode from a photo (for when the live camera cannot read it). */
export async function detectInPhoto(file: Blob): Promise<Detected | null> {
  const bitmap = await createImageBitmap(file);
  try {
    return await detectIn(bitmap);
  } finally {
    bitmap.close();
  }
}
