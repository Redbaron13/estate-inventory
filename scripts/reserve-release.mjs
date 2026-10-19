// Called only by trusted deployment jobs with contents:write. Optimistic locking
// on the contents API prevents collisions even outside the workflow concurrency group.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const repo = process.env.GITHUB_REPOSITORY;
if (!repo || !process.env.GH_TOKEN) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required.');
const root = `repos/${repo}`;
function api(path, method = 'GET', body) {
  const args = ['api', `${root}/${path}`, '--method', method];
  if (body) args.push('--input', '-');
  return JSON.parse(execFileSync('gh', args, { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
}
function missing(error) { return String(error.stderr).includes('404'); }
try { api('git/ref/heads/release-registry'); } catch (e) {
  if (!missing(e)) throw e;
  api('git/refs', 'POST', { ref: 'refs/heads/release-registry', sha: process.env.GITHUB_SHA });
}
let stored;
try { stored = api('contents/release-registry.json?ref=release-registry'); } catch (e) { if (!missing(e)) throw e; }
const path = `${process.env.RUNNER_TEMP || '/tmp'}/estate-release-registry.json`;
writeFileSync(path, stored ? Buffer.from(stored.content, 'base64') : '{"schema":1,"releases":[]}');
execFileSync(process.execPath, ['scripts/prepare-release.mjs', '--deploy'], { env: { ...process.env, RELEASE_REGISTRY: path }, stdio: 'inherit' });
api('contents/release-registry.json', 'PUT', {
  message: `Reserve release ${process.env.RELEASE_KEY}`,
  branch: 'release-registry',
  content: Buffer.from(readFileSync(path)).toString('base64'),
  ...(stored ? { sha: stored.sha } : {}),
  committer: { name: 'Kevin Baron', email: '98280733+Redbaron13@users.noreply.github.com' },
});
