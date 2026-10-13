import { getMeta, setMeta } from './db';

export interface Diagnostic {
  at: string;
  level: 'warning' | 'error';
  area: 'runtime' | 'api' | 'sync' | 'storage' | 'compatibility';
  code: string;
  message: string;
}

const KEY = 'diagnostics';
const LIMIT = 40;
let writing = Promise.resolve();

export function recordDiagnostic(
  level: Diagnostic['level'],
  area: Diagnostic['area'],
  code: string,
  message: string,
) {
  const entry: Diagnostic = {
    at: new Date().toISOString(),
    level,
    area,
    code: /^[A-Z0-9_-]{1,40}$/.test(code) ? code : 'UNKNOWN',
    message,
  };
  writing = writing.then(async () => {
    const current = await getMeta<Diagnostic[]>(KEY, []);
    await setMeta(KEY, [...current, entry].slice(-LIMIT));
  }).catch(() => {
    console.warn('Could not save local troubleshooting information.');
  });
  if (import.meta.env.DEV) console.warn(`[${entry.area}:${entry.code}] ${entry.message}`);
  return writing;
}
