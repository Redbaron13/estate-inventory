import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// A full CLI config push inherits local test settings and attempts template
// changes rejected by the default sender. Patch only the app-owned settings.
export function authPatch(current, site, template, confirmationTemplate) {
  const url = new URL(site);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Hosted site must use HTTPS.');
  const redirects = new Set(String(current.uri_allow_list || '').split(',').filter(Boolean));
  redirects.add(url.href);
  const patch = { site_url: url.href, uri_allow_list: [...redirects].join(','), mailer_otp_length: 6, mailer_otp_exp: 900 };
  if (current.smtp_host) {
    if (!confirmationTemplate?.includes('{{ .ConfirmationURL }}')) throw new Error('Account confirmation requires a confirmation link.');
    for (const kind of ['magic_link', 'confirmation']) {
      patch[`mailer_subjects_${kind}`] = kind === 'confirmation' ? 'Confirm your Estate Inventory account' : 'Your Estate Inventory sign-in code';
      patch[`mailer_templates_${kind}_content`] = kind === 'confirmation' ? confirmationTemplate : template;
    }
  }
  return patch;
}

export async function configureAuth(env = process.env, request = fetch) {
  const ref = env.TARGET === 'production' ? env.PROD_REF : env.TARGET === 'staging' ? env.STAGING_REF : '';
  if (!/^[a-z0-9]+$/.test(ref || '') || !env.SUPABASE_ACCESS_TOKEN) throw new Error('Missing hosted auth configuration.');
  const endpoint = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
  const headers = { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
  async function call(method, body) {
    const result = await request(endpoint, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
    // Responses can contain credentials. Never print response bodies or headers.
    if (!result.ok) throw new Error(`Hosted auth ${method} failed (HTTP ${result.status}). Check Supabase project permissions and SMTP settings.`);
    return result.json();
  }
  const current = await call('GET');
  const patch = authPatch(current, env.SITE_URL, readFileSync('supabase/templates/sign-in-code.html', 'utf8'), readFileSync('supabase/templates/confirm-account.html', 'utf8'));
  await call('PATCH', patch);
  const verified = await call('GET');
  for (const [key, value] of Object.entries(patch)) {
    if (verified[key] !== value) throw new Error(`Hosted auth verification failed for ${key}.`);
  }
  console.log(current.smtp_host ? 'Hosted redirect and six-digit code templates verified.' : 'Hosted redirects verified. Custom SMTP is absent; existing email templates retained. Password sign-in remains available.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await configureAuth();
