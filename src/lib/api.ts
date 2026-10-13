import { API_URL } from './config';
import { accessToken } from './supabase';
import { recordDiagnostic } from './diagnostics';

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Worth retrying later (network trouble, server hiccup, expired sign-in) rather than a refusal. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 401 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = await accessToken();
  if (!token) {
    void recordDiagnostic('warning', 'api', 'AUTH_REQUIRED', 'A signed-in session is required to contact the API.');
    throw new ApiError(401, 'EI401', 'Please sign in.');
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal ?? AbortSignal.timeout(30000),
    });
  } catch {
    void recordDiagnostic('warning', 'api', 'API_NETWORK_ERROR', `The ${opts.method ?? 'GET'} API request could not reach the server.`);
    throw new ApiError(0, 'NETWORK', 'No connection. Your change is saved on this phone and will upload later.');
  }
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const err = json?.error ?? {};
    void recordDiagnostic('error', 'api', err.code ?? 'HTTP_ERROR', `The ${opts.method ?? 'GET'} API request failed with status ${res.status}.`);
    throw new ApiError(res.status, err.code ?? String(res.status), err.message ?? `Request failed (${res.status}).`, err.details);
  }
  return json as T;
}

/** Fetch a CSV report as text. */
export async function apiText(path: string): Promise<string> {
  const token = await accessToken();
  if (!token) throw new ApiError(401, 'EI401', 'Please sign in.');
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    void recordDiagnostic('error', 'api', 'HTTP_ERROR', `The report request failed with status ${res.status}.`);
    throw new ApiError(res.status, String(res.status), `Request failed (${res.status}).`);
  }
  return res.text();
}
