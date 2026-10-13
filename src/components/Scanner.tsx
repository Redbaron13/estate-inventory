import { useEffect, useRef, useState, type FormEvent } from 'react';
import { detectIn, detectInPhoto, getDetector, type Detected } from '../lib/barcode';
import { Icon } from './Icon';
import { ErrorText } from './ui';
import { recordDiagnostic } from '../lib/diagnostics';

/**
 * Live camera scanner for product barcodes and our QR labels. Works offline.
 * Always offers two fallbacks: photograph the barcode, or type it.
 */
export function Scanner({ onDetect, continuous = false, hint }: { onDetect: (d: Detected) => void; continuous?: boolean; hint?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastRef = useRef<{ value: string; at: number } | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'paused' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [torch, setTorch] = useState<boolean | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function start() {
      try {
        await getDetector();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const caps = (stream.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);
        setStatus('scanning');
        loop();
      } catch (e) {
        setStatus('error');
        const name = (e as Error).name;
        const code = name === 'NotAllowedError' ? 'CAMERA_PERMISSION_DENIED'
          : name === 'NotFoundError' ? 'CAMERA_NOT_FOUND'
            : name === 'NotReadableError' ? 'CAMERA_IN_USE' : 'CAMERA_START_FAILED';
        void recordDiagnostic('warning', 'compatibility', code, 'Camera scanning did not start; photo and manual entry remain available.');
        setError(
          (e as Error).name === 'NotAllowedError'
            ? 'The camera is blocked. Allow camera access for this app in your phone settings, or use the options below.'
            : 'The camera could not start. Use the options below instead.',
        );
      }
    }

    async function loop() {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const found = await detectIn(video);
          if (found) {
            const last = lastRef.current;
            const now = Date.now();
            if (!last || last.value !== found.value || now - last.at > 2500) {
              lastRef.current = { value: found.value, at: now };
              navigator.vibrate?.(60);
              setFlash(found.value);
              setTimeout(() => setFlash(null), 900);
              onDetectRef.current(found);
              if (!continuous) {
                setStatus('paused');
                return;
              }
            }
          }
        } catch {
          /* keep scanning */
        }
      }
      timer = setTimeout(loop, 220);
    }

    void start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [continuous]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      setTorch(null);
    }
  }

  async function fromPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const found = await detectInPhoto(file);
      if (found) onDetect(found);
      else setError('No barcode found in that photo. Try again closer, with good light, or type the number.');
    } catch {
      void recordDiagnostic('warning', 'compatibility', 'BARCODE_PHOTO_READ_FAILED', 'A barcode could not be read from a selected photo.');
      setError('That photo could not be read.');
    }
  }

  function submitManual(e: FormEvent) {
    e.preventDefault();
    const value = manual.trim();
    if (!value) return;
    onDetect({ value, format: 'manual' });
    setManual('');
  }

  return (
    <div>
      {status !== 'error' && (
        <div className="relative mb-4 overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted aria-label="Camera view" />
          <div className="pointer-events-none absolute inset-[18%_10%] rounded-xl border-4 border-white/80" />
          {flash && (
            <div className="absolute inset-x-3 bottom-3 rounded-xl bg-white/95 px-3 py-2 text-center font-bold text-black">
              <Icon name="check" size={18} className="mr-1 inline" /> {flash}
            </div>
          )}
          {status === 'starting' && <div className="absolute inset-0 flex items-center justify-center text-white">Starting camera…</div>}
          {torch !== null && (
            <button type="button" onClick={toggleTorch} className="btn absolute right-2 top-2 min-h-10 bg-black/60 px-3 text-white">
              {torch ? 'Light off' : 'Light on'}
            </button>
          )}
        </div>
      )}
      {hint && status !== 'error' && <p className="mb-4 text-ink-soft">{hint}</p>}
      {status === 'paused' && !continuous && (
        <p className="mb-4 font-bold">Got it.</p>
      )}
      <ErrorText error={error} />
      <div className="mt-3 grid gap-3">
        <label className="btn btn-secondary">
          <Icon name="camera" /> Photograph the barcode instead
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void fromPhoto(e.target.files?.[0])} />
        </label>
        <form onSubmit={submitManual} className="flex gap-2">
          <label htmlFor="manual-code" className="sr-only">Type a barcode or code</label>
          <input id="manual-code" className="input code flex-1" inputMode="text" autoCapitalize="characters" placeholder="Or type the number or code" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="btn btn-primary px-4" disabled={!manual.trim()}>Use</button>
        </form>
      </div>
    </div>
  );
}
