const env = import.meta.env;

export const SUPABASE_URL: string = env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY: string = env.VITE_SUPABASE_ANON_KEY ?? '';
export const API_URL: string = env.VITE_API_URL ?? `${SUPABASE_URL}/functions/v1/api/v1`;
export const APP_ENV: string = env.VITE_APP_ENV ?? 'local';
export const APP_VERSION: string = env.VITE_APP_VERSION ?? '0.1.0';
export const MEDIA_BUCKET = 'estate-media';

/** Keep at least this many inventory numbers on each device for offline capture. */
export const NUMBER_POOL_MIN = 25;
export const NUMBER_POOL_REFILL = 50;
