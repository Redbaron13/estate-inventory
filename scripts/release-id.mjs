import { createHash } from 'node:crypto';

export const DISTRIBUTIONS = ['DH', 'DT', 'MC', 'IN', 'LX', 'WB'];
export const ARCHITECTURES = ['x6', 'x1', 'x3'];
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// A cohort character must work for every distribution and architecture.
const COHORTS = [...ALPHABET].filter(c => !'DHDTMCINLXWBX163'.includes(c));
export function minorCohort(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Version must be major.minor.patch without leading zeros.');
  const minor = version.split('.').slice(0, 2).join('.');
  const n = createHash('sha256').update(minor).digest().readUInt32BE(0);
  return COHORTS[n % COHORTS.length];
}
function checkCharacter(prefix, first, second, fourth) {
  const chars = [...ALPHABET].filter(c => !(prefix + first + second + fourth).toUpperCase().includes(c));
  const text = prefix + first + second + '_' + fourth;
  const sum = [...text.toUpperCase()].reduce((n, c, i) => n + (i === 6 ? 0 : (ALPHABET.indexOf(c) + 1) * (i + 1)), 0);
  return chars[sum % chars.length];
}
export function validateReleaseId(id, version) {
  const raw = id.startsWith('ZY') ? id.slice(2) : id;
  if (raw.length !== 8 || !DISTRIBUTIONS.includes(raw.slice(0, 2)) || !ARCHITECTURES.includes(raw.slice(2, 4))) return false;
  const [first, second, third, fourth] = raw.slice(4);
  if (!/^[0-9A-Z]{4}$/.test(raw.slice(4)) || new Set(raw.slice(4)).size !== 4) return false;
  if ([...raw.slice(4)].some(c => raw.slice(0, 4).toUpperCase().includes(c))) return false;
  return (!version || first === minorCohort(version)) && third === checkCharacter(raw.slice(0, 4), first, second, fourth);
}
export function allocateRelease({ version, distribution = 'WB', architecture = 'x3', deploymentKey, deployed = false, registry = { schema: 1, releases: [] } }) {
  if (!DISTRIBUTIONS.includes(distribution) || !ARCHITECTURES.includes(architecture)) throw new Error('Unsupported distribution or architecture.');
  if (!deploymentKey) throw new Error('A deployment key is required.');
  if (registry.schema !== 1 || !Array.isArray(registry.releases)) throw new Error('Invalid release registry.');
  const previous = registry.releases.find(r => r.deploymentKey === deploymentKey);
  if (previous) {
    if (previous.version !== version || previous.distribution !== distribution || previous.architecture !== architecture || previous.deployed !== deployed || !validateReleaseId(previous.id, version)) throw new Error('Deployment key was already reserved for another release.');
    return previous;
  }
  const prefix = distribution + architecture;
  const first = minorCohort(version);
  const available = [...ALPHABET].filter(c => !(prefix + first).toUpperCase().includes(c));
  const used = new Set(registry.releases.map(r => r.id.replace(/^ZY/, '')));
  // Start from a key-dependent offset, then search every legal pair. Never reuse an ID.
  const offset = createHash('sha256').update(deploymentKey).digest().readUInt32BE(0);
  for (let i = 0; i < available.length ** 2; i++) {
    const n = (offset + i) % (available.length ** 2);
    const second = available[Math.floor(n / available.length)];
    const fourth = available[n % available.length];
    if (second === fourth) continue;
    const raw = prefix + first + second + checkCharacter(prefix, first, second, fourth) + fourth;
    if (used.has(raw)) continue;
    const release = { id: (deployed ? '' : 'ZY') + raw, version, distribution, architecture, deploymentKey, deployed };
    registry.releases.push(release);
    return release;
  }
  throw new Error(`Release ID space exhausted for ${prefix} / cohort ${first}. Stop and extend the agreed format; IDs cannot be reused.`);
}
