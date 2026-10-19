import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { allocateRelease, validateReleaseId } from './release-id.mjs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const deployed = process.argv.includes('--deploy');
function gitValue(args) {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); } catch { return null; }
}
const sourceCommit = process.env.GITHUB_SHA || gitValue(['rev-parse', 'HEAD']);
const sourceBranch = process.env.GITHUB_REF_NAME || gitValue(['branch', '--show-current']) || 'local';
const registryPath = process.env.RELEASE_REGISTRY;
if (deployed && !registryPath) throw new Error('Deployed builds require a persistent RELEASE_REGISTRY.');
const registry = registryPath && existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : { schema: 1, releases: [] };
if (deployed && process.env.RELEASE_ENV === 'production') {
  const previous = registry.releases.filter(r => r.environment === 'production' && r.commit !== process.env.GITHUB_SHA).at(-1);
  if (previous) {
    const currentParts = pkg.version.split('.').map(Number);
    const oldParts = previous.version.split('.').map(Number);
    const firstDifference = currentParts.findIndex((n, i) => n !== oldParts[i]);
    if (firstDifference < 0 || currentParts[firstDifference] < oldParts[firstDifference]) throw new Error('Production version must increase. Use npm version patch, minor, or major before releasing.');
  }
}
const release = allocateRelease({ version: pkg.version, distribution: process.env.RELEASE_DISTRIBUTION || 'WB', architecture: process.env.RELEASE_ARCHITECTURE || 'x3', deploymentKey: process.env.RELEASE_KEY || `local:${sourceCommit || 'working-tree'}:${sourceBranch}`, deployed, registry });
if (!validateReleaseId(release.id, pkg.version)) throw new Error('Invalid generated release ID.');
const manifest = Object.assign(release, { commit: sourceCommit, environment: process.env.RELEASE_ENV || 'development', builtAt: new Date().toISOString() });
writeFileSync('public/release.json', JSON.stringify(manifest, null, 2) + '\n');
if (deployed) writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `id=${release.id}\nversion=${pkg.version}\n`);
console.log(`${pkg.version} / ${release.id} / ${manifest.environment}`);
