// Explicit allowlist: never load deployment credentials into the frontend build.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEPLOY_SECRETS = new Set([
  'SUPABASE_ACCESS_TOKEN', 'PROD_SUPABASE_PROJECT_REF', 'PROD_SUPABASE_DB_PASSWORD',
  'PROD_SUPABASE_URL', 'PROD_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_PROJECT_REF',
  'STAGING_SUPABASE_DB_PASSWORD', 'STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY',
  'STAGING_SITE_URL', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
  'APPLE_CERTIFICATE_P12_BASE64', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY',
  'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'
]);
export function deploymentSecrets(text) {
  return Object.entries(parseEnv(text)).filter(([key, value]) => DEPLOY_SECRETS.has(key) && value.length > 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pathArg = process.argv.find(a => a.startsWith('--file='));
  const file = pathArg ? pathArg.slice(7) : 'textfile/.env';
  const values = parseEnv(readFileSync(file, 'utf8'));
  const selected = deploymentSecrets(readFileSync(file, 'utf8'));
  if (!selected.length) throw new Error('No supported deployment keys found. See textfile/README.md.');
  console.log(`Deployment keys found: ${selected.map(([key]) => key).join(', ')}`);
  if (!process.argv.includes('--apply')) console.log('Preview only. Add --apply to store these values as GitHub repository secrets.');
  else {
    const env = { ...process.env, ...(values.GH_TOKEN || values.GITHUB_TOKEN ? { GH_TOKEN: values.GH_TOKEN || values.GITHUB_TOKEN } : {}) };
    for (const [key, value] of selected) {
      const result = spawnSync('gh', ['secret', 'set', key, '--repo', 'Redbaron13/estate-inventory'], { input: value, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      if (result.error || result.status !== 0) throw new Error(`Could not set ${key}. Check GitHub CLI authentication and repository secrets permission. No value was printed.`);
      console.log(`Stored ${key}`);
    }
  }
}
