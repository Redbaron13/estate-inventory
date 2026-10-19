const env = import.meta.env;

export const SUPABASE_URL: string = env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY: string = env.VITE_SUPABASE_ANON_KEY ?? '';
export const API_URL: string = env.VITE_API_URL ?? `${SUPABASE_URL}/functions/v1/api/v1`;
export const APP_ENV: string = env.VITE_APP_ENV ?? 'local';
export const APP_VERSION: string = env.VITE_APP_VERSION ?? '0.2.0';
export const RESET_PASSWORD_FLAG: boolean = env.VITE_RESET_PASSWORD_FLAG === 'true';
export const MEDIA_BUCKET = 'estate-media';

/** Keep at least this many inventory numbers on each device for offline capture. */
// Item numbers each phone holds for offline use. Small blocks keep numbers close
// to the real item count; captures beyond a block are kept as drafts and get
// numbers on reconnect, so nothing is lost.
export const NUMBER_POOL_MIN = 8;
export const NUMBER_POOL_REFILL = 20;


export const DEPLOYMENT_ID: string = env.VITE_DEPLOYMENT_ID ?? 'Development';
