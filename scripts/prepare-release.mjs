import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { allocateRelease, validateReleaseId } from './release-id.mjs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const deployed = process.argv.includes('--deploy');
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
const release = allocateRelease({ version: pkg.version, distribution: process.env.RELEASE_DISTRIBUTION || 'WB', architecture: process.env.RELEASE_ARCHITECTURE || 'x3', deploymentKey: process.env.RELEASE_KEY || `local:${process.env.GITHUB_SHA || 'working-tree'}:${process.env.GITHUB_REF_NAME || 'local'}`, deployed, registry });
if (!validateReleaseId(release.id, pkg.version)) throw new Error('Invalid generated release ID.');
const manifest = Object.assign(release, { commit: process.env.GITHUB_SHA || null, environment: process.env.RELEASE_ENV || 'development', builtAt: new Date().toISOString() });
writeFileSync('public/release.json', JSON.stringify(manifest, null, 2) + '\n');
if (deployed) writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `id=${release.id}\nversion=${pkg.version}\n`);
console.log(`${pkg.version} / ${release.id} / ${manifest.environment}`);
