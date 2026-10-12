// Estate Inventory API (/api/v1). Supabase Edge Function (Deno) using Hono.
//
// Every request runs with the caller's own token, so Row Level Security and
// the database workflow functions decide what is allowed. This function never
// uses the service-role key.
//
// Writes accept an Idempotency-Key header. Devices replaying queued offline
// requests send the same key and get the original response back.
import { Hono, type Context } from 'npm:hono@4.13.13';
import { cors } from 'npm:hono@4.13.13/cors';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { classifyScan, parseItemCode, parseLocationCode } from '../_shared/codes.ts';
import { allPossibleDuplicates, emptyEstateData, type EstateData, type LedgerEntry } from '../_shared/domain.ts';
import { sha256Hex } from '../_shared/ledger.ts';
import {
  activityReport, distributionReport, exceptionsReport, inventoryReport, toCSV, valuationReport,
} from '../_shared/reports.ts';

const VERSION = '0.1.0';
const BUCKET = 'estate-media';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '*').split(',').map((s) => s.trim()).filter(Boolean);

type Env = { Variables: { db: SupabaseClient; userId: string; token: string } };

const app = new Hono<Env>().basePath('/api/v1');

app.use(
  '*',
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin) ? origin || '*' : ''),
    allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'apikey', 'x-client-info'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    exposeHeaders: ['Idempotency-Replayed'],
    maxAge: 86400,
  }),
);

// ---------------------------------------------------------------------------
// Errors: database codes EI4xx carry their HTTP status in the code.
// ---------------------------------------------------------------------------
interface DbError { code?: string; message?: string; details?: string; hint?: string }

function statusFor(code: string | undefined): number {
  if (!code) return 500;
  if (/^EI4\d\d$/.test(code)) return Number(code.slice(2));
  switch (code) {
    case '42501': return 403; // insufficient privilege
    case '22P02': case '22007': case '22008': case '22003': return 400; // bad uuid/enum/date/number
    case '23505': return 409; // unique violation
    case '23503': return 422; // foreign key: referenced record missing
    case '23514': case '23502': return 422; // check / not null
    case 'PGRST301': case 'PGRST302': return 401;
    default: return 500;
  }
}

function errorBody(err: DbError) {
  let details: unknown = undefined;
  if (err.details) {
    try { details = JSON.parse(err.details); } catch { details = err.details; }
  }
  const status = statusFor(err.code);
  return {
    status,
    body: {
      error: {
        code: err.code ?? 'UNKNOWN',
        message: status === 500 ? 'Something went wrong on the server. Your change was not saved; try again.' : err.message,
        details,
      },
    },
  };
}

function fail(c: Context, err: DbError) {
  const { status, body } = errorBody(err);
  if (status === 500) console.error('API error', err);
  return c.json(body, status as 400);
}

// ---------------------------------------------------------------------------
// Auth: build a client that acts as the caller.
// ---------------------------------------------------------------------------
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.path.endsWith('/health')) return next();
  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return c.json({ error: { code: 'EI401', message: 'Please sign in.' } }, 401);
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return c.json({ error: { code: 'EI401', message: 'Your sign-in has expired. Please sign in again.' } }, 401);
  c.set('db', db);
  c.set('userId', data.user.id);
  c.set('token', token);
  await next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  } catch {
    return {};
  }
}

/** Run a workflow operation through public.api() with idempotency. */
async function mutate(c: Context<Env>, fn: string, args: Record<string, unknown>, okStatus = 200) {
  const key = c.req.header('Idempotency-Key') || crypto.randomUUID();
  const requestHash = await sha256Hex(`${fn} ${stableStringify(args)}`);
  const { data, error } = await c.get('db').rpc('api', { p_fn: fn, p_args: args, p_key: key, p_request_hash: requestHash });
  if (error) return fail(c, error);
  c.header('Idempotency-Replayed', String(Boolean(data?.replayed)));
  return c.json(data?.result ?? null, (data?.replayed ? 200 : okStatus) as 200);
}

async function pull(c: Context<Env>, estateId: string, since = '0'): Promise<{ data?: any; error?: DbError }> {
  const { data, error } = await c.get('db').rpc('pull_changes', { p_estate_id: estateId, p_since: since });
  return error ? { error } : { data };
}

function toEstateData(p: any): EstateData {
  const d = emptyEstateData();
  d.estate = p.estates?.[0] ?? null;
  for (const k of Object.keys(d) as (keyof EstateData)[]) {
    if (k === 'estate') continue;
    const src = k === 'members' ? p.members : p[k];
    if (Array.isArray(src)) (d as any)[k] = src;
  }
  return d;
}

async function allLedger(c: Context<Env>, estateId: string): Promise<{ entries?: LedgerEntry[]; error?: DbError }> {
  const entries: LedgerEntry[] = [];
  let after = 0;
  for (;;) {
    const { data, error } = await c.get('db').rpc('ledger_page', { p_estate_id: estateId, p_after_seq: after, p_limit: 2000 });
    if (error) return { error };
    const page = (data?.entries ?? []) as LedgerEntry[];
    entries.push(...page);
    if (page.length < 2000) return { entries };
    after = page[page.length - 1].estate_seq;
  }
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf',
};

// ---------------------------------------------------------------------------
// Health and identity
// ---------------------------------------------------------------------------
app.get('/health', (c) => c.json({ ok: true, version: VERSION, time: new Date().toISOString() }));

app.get('/me', async (c) => {
  const db = c.get('db');
  const [profile, estates] = await Promise.all([
    db.from('profiles').select('*').eq('id', c.get('userId')).single(),
    db.rpc('my_estates'),
  ]);
  if (profile.error) return fail(c, profile.error);
  if (estates.error) return fail(c, estates.error);
  return c.json({ profile: profile.data, estates: estates.data });
});
app.patch('/me', async (c) => mutate(c, 'update_profile', await body(c)));

// ---------------------------------------------------------------------------
// Estates, members, invitations
// ---------------------------------------------------------------------------
app.get('/estates', async (c) => {
  const { data, error } = await c.get('db').rpc('my_estates');
  return error ? fail(c, error) : c.json(data);
});
app.post('/estates', async (c) => mutate(c, 'create_estate', await body(c), 201));

app.get('/estates/:estateId', async (c) => {
  const db = c.get('db');
  const id = c.req.param('estateId');
  const [estate, members, locations] = await Promise.all([
    db.from('estates').select('*').eq('id', id).maybeSingle(),
    db.from('estate_members').select('*, profile:profiles(id, display_name, email, phone)').eq('estate_id', id),
    db.from('locations').select('*').eq('estate_id', id).is('archived_at', null),
  ]);
  if (estate.error) return fail(c, estate.error);
  if (!estate.data) return c.json({ error: { code: 'EI404', message: 'Estate not found.' } }, 404);
  if (members.error) return fail(c, members.error);
  if (locations.error) return fail(c, locations.error);
  return c.json({ estate: estate.data, members: members.data, locations: locations.data });
});
app.patch('/estates/:estateId', async (c) => {
  const b = await body(c);
  return mutate(c, 'update_estate', { estate_id: c.req.param('estateId'), version: b.version, changes: b.changes ?? {} });
});

app.post('/estates/:estateId/invites', async (c) =>
  mutate(c, 'create_invite', { ...(await body(c)), estate_id: c.req.param('estateId') }, 201));
app.post('/estates/:estateId/invites/:inviteId/revoke', (c) =>
  mutate(c, 'revoke_invite', { estate_id: c.req.param('estateId'), invite_id: c.req.param('inviteId') }));
app.post('/invites/accept', async (c) => mutate(c, 'accept_invite', await body(c)));

app.patch('/estates/:estateId/members/:userId', async (c) => {
  const b = await body(c);
  return mutate(c, 'update_member', { estate_id: c.req.param('estateId'), user_id: c.req.param('userId'), changes: b.changes ?? b });
});
app.post('/estates/:estateId/members/:userId/remove', async (c) =>
  mutate(c, 'remove_member', { ...(await body(c)), estate_id: c.req.param('estateId'), user_id: c.req.param('userId') }));

// ---------------------------------------------------------------------------
// Sync and inventory numbers
// ---------------------------------------------------------------------------
app.get('/estates/:estateId/sync', async (c) => {
  const { data, error } = await pull(c, c.req.param('estateId'), c.req.query('since') ?? '0');
  return error ? fail(c, error) : c.json(data);
});
app.post('/estates/:estateId/inventory-numbers/reserve', async (c) =>
  mutate(c, 'reserve_numbers', { ...(await body(c)), estate_id: c.req.param('estateId') }, 201));
app.post('/estates/:estateId/inventory-numbers/void', async (c) =>
  mutate(c, 'void_numbers', { ...(await body(c)), estate_id: c.req.param('estateId') }));

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------
app.post('/estates/:estateId/locations', async (c) =>
  mutate(c, 'create_location', { ...(await body(c)), estate_id: c.req.param('estateId') }, 201));
app.patch('/estates/:estateId/locations/:locationId', async (c) =>
  mutate(c, 'update_location', { ...(await body(c)), estate_id: c.req.param('estateId'), location_id: c.req.param('locationId') }));
app.get('/estates/:estateId/locations/by-code/:code', async (c) => {
  const parsed = parseLocationCode(c.req.param('code'));
  if (!parsed) return c.json({ error: { code: 'EI422', message: 'That is not a valid place code (check for a typo).' } }, 422);
  const { data, error } = await c.get('db').from('locations').select('*')
    .eq('estate_id', c.req.param('estateId')).eq('code', parsed.code).maybeSingle();
  if (error) return fail(c, error);
  return data ? c.json(data) : c.json({ error: { code: 'EI404', message: 'No place with that code in this estate.' } }, 404);
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
app.get('/estates/:estateId/items', async (c) => {
  const q = c.req.query();
  let query = c.get('db').from('items').select('*', { count: 'exact' }).eq('estate_id', c.req.param('estateId'));
  if (q.status) query = query.in('status', q.status.split(','));
  if (q.location_id) query = query.eq('current_location_id', q.location_id);
  if (q.category) query = query.eq('category', q.category);
  if (q.valuable === 'true') query = query.eq('potentially_valuable', true);
  if (q.include_merged !== 'true') query = query.neq('status', 'MERGED');
  if (q.q) {
    const term = q.q.replace(/[%,()]/g, ' ').trim();
    if (/^\d+$/.test(term)) query = query.or(`inventory_number.eq.${Number(term)},barcode.eq.${term}`);
    else query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%,item_code.ilike.%${term}%,serial_number.ilike.%${term}%,brand.ilike.%${term}%`);
  }
  const limit = Math.min(Number(q.limit ?? 100) || 100, 500);
  const offset = Number(q.offset ?? 0) || 0;
  const { data, error, count } = await query.order('inventory_number').range(offset, offset + limit - 1);
  return error ? fail(c, error) : c.json({ items: data, total: count, limit, offset });
});

app.post('/estates/:estateId/items', async (c) =>
  mutate(c, 'create_item', { ...(await body(c)), estate_id: c.req.param('estateId') }, 201));

app.get('/estates/:estateId/items/by-code/:code', async (c) => {
  const parsed = parseItemCode(c.req.param('code'));
  if (!parsed) return c.json({ error: { code: 'EI422', message: 'That is not a valid item code (check for a typo).' } }, 422);
  const { data, error } = await c.get('db').from('items').select('*')
    .eq('estate_id', c.req.param('estateId')).eq('item_code', parsed.code).maybeSingle();
  if (error) return fail(c, error);
  return data ? c.json(data) : c.json({ error: { code: 'EI404', message: 'No item with that code in this estate.' } }, 404);
});

app.get('/estates/:estateId/items/:itemId', async (c) => {
  const db = c.get('db');
  const id = c.req.param('itemId');
  const [item, media, valuations, custody, proposals, rounds, claims, reviews, redactions] = await Promise.all([
    db.from('items').select('*').eq('id', id).maybeSingle(),
    db.from('media').select('*').eq('item_id', id).order('created_at'),
    db.from('valuations').select('*').eq('item_id', id).order('created_at'),
    db.from('custody_events').select('*').eq('item_id', id).order('occurred_at'),
    db.from('proposals').select('*, outcome:proposal_outcomes(*), completion:proposal_completions(*), cancellation:proposal_cancellations(*), decisions:proposal_decisions(*)').eq('item_id', id).order('created_at'),
    db.from('grab_rounds').select('*, resolution:grab_resolutions(*)').eq('item_id', id).order('created_at'),
    db.from('claims').select('*').eq('item_id', id).order('created_at'),
    db.from('duplicate_reviews').select('*').or(`item_id.eq.${id},other_item_id.eq.${id}`),
    db.from('redactions').select('media_id').eq('estate_id', c.req.param('estateId')),
  ]);
  for (const r of [item, media, valuations, custody, proposals, rounds, claims, reviews, redactions]) if (r.error) return fail(c, r.error);
  if (!item.data) return c.json({ error: { code: 'EI404', message: 'Item not found.' } }, 404);
  const hidden = new Set((redactions.data ?? []).map((r: { media_id: string }) => r.media_id));
  return c.json({
    item: item.data,
    media: (media.data ?? []).filter((m: { id: string }) => !hidden.has(m.id)),
    valuations: valuations.data, custody: custody.data, proposals: proposals.data,
    grab_rounds: rounds.data, claims: claims.data, duplicate_reviews: reviews.data,
  });
});

app.patch('/estates/:estateId/items/:itemId', async (c) => {
  const b = await body(c);
  const version = b.version ?? (c.req.header('If-Match') ? Number(c.req.header('If-Match')!.replace(/\D/g, '')) : undefined);
  return mutate(c, 'update_item', {
    estate_id: c.req.param('estateId'), item_id: c.req.param('itemId'), version, changes: b.changes ?? {},
  });
});

// Photos and files: content-addressed upload, then registration with a hash check.
app.post('/estates/:estateId/items/:itemId/photos/upload-url', async (c) => {
  const b = await body(c);
  const sha = String(b.sha256 ?? '').toLowerCase();
  const ext = MIME_EXT[String(b.mime_type ?? '')];
  if (!/^[0-9a-f]{64}$/.test(sha) || !ext) {
    return c.json({ error: { code: 'EI422', message: 'sha256 (64 hex) and a supported mime_type are required.' } }, 422);
  }
  const path = `${c.req.param('estateId')}/${sha}.${ext}`;
  const storage = c.get('db').storage.from(BUCKET);
  const exists = await storage.exists(path);
  if (exists.data) return c.json({ path, already_uploaded: true });
  const { data, error } = await storage.createSignedUploadUrl(path);
  if (error) {
    if (/exist/i.test(error.message)) return c.json({ path, already_uploaded: true });
    return c.json({ error: { code: 'EI403', message: `Upload not allowed: ${error.message}` } }, 403);
  }
  return c.json({ path, already_uploaded: false, signed_url: data.signedUrl, token: data.token });
});

app.post('/estates/:estateId/items/:itemId/photos', async (c) => {
  const b = await body(c);
  const estateId = c.req.param('estateId');
  const storage = c.get('db').storage.from(BUCKET);
  // Re-hash what was actually stored, so a file can never be registered under the wrong fingerprint.
  for (const [shaKey, ext] of [['sha256', MIME_EXT[String(b.mime_type ?? '')]], ['thumb_sha256', 'jpg']] as const) {
    const sha = b[shaKey] ? String(b[shaKey]).toLowerCase() : null;
    if (!sha) continue;
    const file = await storage.download(`${estateId}/${sha}.${ext}`);
    if (file.error || !file.data) {
      return c.json({ error: { code: 'EI422', message: 'Upload the file before registering it.' } }, 422);
    }
    const actual = await sha256Hex(await file.data.arrayBuffer());
    if (actual !== sha) {
      return c.json({ error: { code: 'EI422', message: 'The uploaded file does not match its fingerprint. Upload it again.' } }, 422);
    }
  }
  return mutate(c, 'register_media', { ...b, estate_id: estateId, item_id: c.req.param('itemId') }, 201);
});

app.post('/estates/:estateId/media/:mediaId/redact', async (c) =>
  mutate(c, 'redact_media', { ...(await body(c)), estate_id: c.req.param('estateId'), media_id: c.req.param('mediaId') }));

app.get('/estates/:estateId/media/:mediaId/url', async (c) => {
  const db = c.get('db');
  const { data: m, error } = await db.from('media').select('storage_path, thumb_path').eq('id', c.req.param('mediaId')).maybeSingle();
  if (error) return fail(c, error);
  if (!m) return c.json({ error: { code: 'EI404', message: 'File not found.' } }, 404);
  const path = c.req.query('thumb') === '1' && m.thumb_path ? m.thumb_path : m.storage_path;
  // Short-lived link (5 minutes); redacted files are refused by storage policy.
  const signed = await db.storage.from(BUCKET).createSignedUrl(path, 300);
  if (signed.error) return c.json({ error: { code: 'EI403', message: 'This file is not available.' } }, 403);
  return c.json({ url: signed.data.signedUrl, expires_in: 300 });
});

app.post('/estates/:estateId/items/:itemId/valuations', async (c) =>
  mutate(c, 'add_valuation', { ...(await body(c)), estate_id: c.req.param('estateId'), item_id: c.req.param('itemId') }, 201));

app.post('/estates/:estateId/items/:itemId/custody', async (c) =>
  mutate(c, 'record_custody', { ...(await body(c)), estate_id: c.req.param('estateId'), item_id: c.req.param('itemId') }, 201));

// ---------------------------------------------------------------------------
// Up for grabs, proposals, decisions
// ---------------------------------------------------------------------------
app.post('/estates/:estateId/items/:itemId/grab-rounds', async (c) =>
  mutate(c, 'open_round', { ...(await body(c)), estate_id: c.req.param('estateId'), item_id: c.req.param('itemId') }, 201));
app.put('/estates/:estateId/items/:itemId/claims', async (c) =>
  mutate(c, 'set_claim', { ...(await body(c)), estate_id: c.req.param('estateId'), item_id: c.req.param('itemId') }));
app.post('/estates/:estateId/grab-rounds/:roundId/resolve', async (c) =>
  mutate(c, 'resolve_round', { ...(await body(c)), estate_id: c.req.param('estateId'), round_id: c.req.param('roundId') }));

app.post('/estates/:estateId/items/:itemId/proposals', async (c) =>
  mutate(c, 'create_proposal', { ...(await body(c)), estate_id: c.req.param('estateId'), item_id: c.req.param('itemId') }, 201));
app.put('/estates/:estateId/proposals/:proposalId/decision', async (c) =>
  mutate(c, 'decide', { ...(await body(c)), estate_id: c.req.param('estateId'), proposal_id: c.req.param('proposalId') }));
app.post('/estates/:estateId/proposals/:proposalId/withdraw', async (c) =>
  mutate(c, 'withdraw_proposal', { ...(await body(c)), estate_id: c.req.param('estateId'), proposal_id: c.req.param('proposalId') }));
app.post('/estates/:estateId/proposals/:proposalId/complete', async (c) =>
  mutate(c, 'complete_proposal', { ...(await body(c)), estate_id: c.req.param('estateId'), proposal_id: c.req.param('proposalId') }));
app.post('/estates/:estateId/decisions/:decisionId/invalidate', async (c) =>
  mutate(c, 'invalidate_decision', { ...(await body(c)), estate_id: c.req.param('estateId'), decision_id: c.req.param('decisionId') }));

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------
app.get('/estates/:estateId/duplicates', async (c) => {
  const { data, error } = await pull(c, c.req.param('estateId'));
  if (error) return fail(c, error);
  const pairs = allPossibleDuplicates(toEstateData(data)).map((p) => ({
    item_id: p.item.id, item_number: p.item.inventory_number, item_title: p.item.title,
    other_item_id: p.other.id, other_number: p.other.inventory_number, other_title: p.other.title,
    reasons: p.reasons, previously_unsure: p.unsure,
  }));
  return c.json({ pairs });
});
app.post('/estates/:estateId/duplicates/review', async (c) =>
  mutate(c, 'review_duplicate', { ...(await body(c)), estate_id: c.req.param('estateId') }, 201));

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
app.get('/estates/:estateId/ledger', async (c) => {
  const { data, error } = await c.get('db').rpc('ledger_page', {
    p_estate_id: c.req.param('estateId'),
    p_after_seq: Number(c.req.query('after_seq') ?? 0) || 0,
    p_limit: Math.min(Number(c.req.query('limit') ?? 500) || 500, 2000),
  });
  return error ? fail(c, error) : c.json(data);
});
app.get('/estates/:estateId/ledger/verify', async (c) => {
  const { data, error } = await c.get('db').rpc('verify_ledger', { p_estate_id: c.req.param('estateId') });
  return error ? fail(c, error) : c.json(data);
});

// ---------------------------------------------------------------------------
// Reports (CSV). PDFs are generated on the device so they work offline.
// ---------------------------------------------------------------------------
app.get('/estates/:estateId/reports/:file', async (c) => {
  const file = c.req.param('file');
  const estateId = c.req.param('estateId');
  const name = file.replace(/\.csv$/, '');
  if (!file.endsWith('.csv') || !['inventory', 'valuation', 'distribution', 'exceptions', 'activity'].includes(name)) {
    return c.json({ error: { code: 'EI404', message: 'Unknown report.' } }, 404);
  }
  const db = c.get('db');
  const { data: member } = await db.from('estate_members').select('can_export')
    .eq('estate_id', estateId).eq('user_id', c.get('userId')).maybeSingle();
  if (!member?.can_export) return c.json({ error: { code: 'EI403', message: 'Your role in this estate does not allow exports.' } }, 403);
  const { data, error } = await pull(c, estateId);
  if (error) return fail(c, error);
  const estate = toEstateData(data);
  let table;
  if (name === 'activity') {
    const ledger = await allLedger(c, estateId);
    if (ledger.error) return fail(c, ledger.error);
    table = activityReport(ledger.entries!, estate);
  } else {
    table = { inventory: inventoryReport, valuation: valuationReport, distribution: distributionReport, exceptions: exceptionsReport }[name as 'inventory'](estate);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCSV(table), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}-${stamp}.csv"`,
    },
  });
});

// ---------------------------------------------------------------------------
// Barcode lookup: a suggestion only. It never overwrites what the family recorded.
// ---------------------------------------------------------------------------
app.get('/barcode/:value', async (c) => {
  const scan = classifyScan(c.req.param('value'));
  if (scan.type !== 'barcode' || !/^\d{8,14}$/.test(scan.value)) return c.json({ found: false });
  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${scan.value}`, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return c.json({ found: false, source: 'upcitemdb', status: res.status });
    const j = await res.json();
    const it = j?.items?.[0];
    if (!it) return c.json({ found: false, source: 'upcitemdb' });
    return c.json({ found: true, source: 'upcitemdb', title: it.title ?? null, brand: it.brand ?? null, model: it.model ?? null, category: it.category ?? null });
  } catch {
    return c.json({ found: false, source: 'upcitemdb', offline: true });
  }
});

app.notFound((c) => c.json({ error: { code: 'EI404', message: 'Not found.' } }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: { code: 'UNKNOWN', message: 'Something went wrong on the server. Your change was not saved; try again.' } }, 500);
});

Deno.serve(app.fetch);
