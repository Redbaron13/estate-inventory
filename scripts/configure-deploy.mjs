import { appendFileSync } from 'node:fs';
if (process.env.TARGET === 'staging') {
  const ref = process.env.STAGING_REF;
  const site = new URL(process.env.SITE_URL).href;
  if (!/^[a-z0-9]+$/.test(ref || '')) throw new Error('Invalid staging project reference.');
  // Runtime-only remote overrides keep hosted auth away from localhost and
  // leave the checked-in local test configuration unchanged.
  appendFileSync('supabase/config.toml', `\n[remotes.staging]\nproject_id = ${JSON.stringify(ref)}\n\n[remotes.staging.auth]\nsite_url = ${JSON.stringify(site)}\nadditional_redirect_urls = [${JSON.stringify(site)}]\n`);
}
