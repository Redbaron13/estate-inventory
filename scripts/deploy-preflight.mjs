import { pathToFileURL } from 'node:url';

/** Validate every destination before a migration, auth change or release allocation. */
export function deploymentTarget(env) {
  const production = env.TARGET === 'production';
  if (!production && env.TARGET !== 'staging') throw new Error('Unknown deployment environment.');
  const branch = production ? 'mainbranch' : 'develop';
  if (env.GITHUB_REF_NAME !== branch || env.GITHUB_REF !== `refs/heads/${branch}`) throw new Error('Deploy production from mainbranch and staging from develop.');
  const ref = production ? env.PROD_REF : env.STAGING_REF;
  const client = new URL(env.VITE_SUPABASE_URL);
  const site = new URL(env.SITE_URL);
  for (const url of [client, site]) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) throw new Error('Deployment destinations must be plain HTTPS URLs.');
  }
  if (client.pathname !== '/') throw new Error('Supabase URL must contain only its origin.');
  if (ref && client.hostname !== `${ref}.supabase.co`) throw new Error('Backend project reference does not match the frontend Supabase URL.');
  if (!production) {
    const prod = new URL(env.PRODUCTION_URL);
    if (!ref || ref === env.PROD_REF || client.origin === prod.origin || site.origin === new URL(env.PRODUCTION_SITE_URL).origin) throw new Error('Staging must use a separate backend and website.');
  }
  const key = env.VITE_SUPABASE_ANON_KEY || '';
  let publicKey = key.startsWith('sb_publishable_');
  if (key.startsWith('eyJ')) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { /* Reject malformed keys without printing them. */ }
  }
  if (!publicKey) throw new Error('Frontend requires a publishable or anon key. Privileged keys are forbidden.');
  return { site: site.href };
}

export async function preflight(env = process.env, request = fetch) {
  const { site } = deploymentTarget(env);
  // Certificate validation stays enabled. Do not migrate a backend for an unreachable app.
  const response = await request(site, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok && response.status !== 404) throw new Error(`Website preflight failed (HTTP ${response.status}).`);
  console.log('Deployment destinations and website HTTPS verified.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await preflight();
