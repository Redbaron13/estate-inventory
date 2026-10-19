import { execFileSync } from 'node:child_process';
const repo = process.env.GITHUB_REPOSITORY;
let baseline;
try {
  const stored = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/contents/release.json?ref=gh-pages`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
  const release = JSON.parse(Buffer.from(stored.content, 'base64').toString('utf8'));
  if (!/^[a-f0-9]{40}$/.test(release.commit)) throw new Error('Published release has no valid source commit.');
  baseline = release.commit;
} catch (e) {
  if (!String(e.stderr).includes('404')) throw e;
  // Bootstrap only: old deployments did not contain a release manifest.
  baseline = process.env.BEFORE && !/^0+$/.test(process.env.BEFORE) ? process.env.BEFORE : 'HEAD^';
}
const changed = execFileSync('git', ['diff', '--name-only', baseline, 'HEAD', '--', 'supabase/'], { encoding: 'utf8' }).trim();
if (changed) throw new Error(`Backend files changed since ${baseline}, but Supabase deployment credentials are missing. Refusing a partial release.\n${changed}`);
console.log(`Backend unchanged since ${baseline}. Existing API can serve this frontend release.`);
