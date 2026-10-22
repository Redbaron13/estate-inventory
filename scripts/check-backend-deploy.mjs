import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function publishedCommit(site, request = fetch) {
  const base = new URL(site.endsWith('/') ? site : `${site}/`);
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Hosted site must use HTTPS.');
  const url = new URL('release.json', base);
  url.searchParams.set('check', process.env.GITHUB_RUN_ID || String(Date.now()));
  const response = await request(url, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Cannot verify the published backend baseline (HTTP ${response.status}).`);
  const release = await response.json();
  if (!/^[a-f0-9]{40}$/.test(release.commit)) throw new Error('Published release has no valid source commit.');
  return release.commit;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The live manifest is authoritative for artifact deployments. gh-pages can
  // contain a failed or obsolete branch build and is not a deployment record.
  const baseline = await publishedCommit(process.env.SITE_URL) || (process.env.BEFORE && !/^0+$/.test(process.env.BEFORE) ? process.env.BEFORE : 'HEAD^');
  const changed = execFileSync('git', ['diff', '--name-only', baseline, 'HEAD', '--', 'supabase/'], { encoding: 'utf8' }).trim();
  if (changed) throw new Error(`Backend files changed since ${baseline}, but Supabase deployment credentials are missing. Refusing a partial release.\n${changed}`);
  console.log(`Backend unchanged since ${baseline}. Existing API can serve this frontend release.`);
}
