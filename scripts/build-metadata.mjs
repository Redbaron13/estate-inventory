import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validateReleaseId } from './release-id.mjs';
if (process.env.RELEASE_PREPARED === 'true') {
  const release = JSON.parse(readFileSync('public/release.json', 'utf8'));
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  if (!release.deployed || !validateReleaseId(release.id, version) || release.version !== version || release.commit !== process.env.GITHUB_SHA) throw new Error('Prepared deployment metadata does not match this build.');
} else {
  execFileSync(process.execPath, ['scripts/prepare-release.mjs'], { stdio: 'inherit' });
}
