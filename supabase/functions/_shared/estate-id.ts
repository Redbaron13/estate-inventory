// Estate ID engine: 18 characters.
//   time hex (5) + name slug (5) + sequence tier+digits (4) + random (3),
//   with a mod-36 check character injected after the 15th character.
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const EPOCH_MS = Date.UTC(1995, 8, 12, 2, 30, 0);
export const ESTATE_ID_PATTERN = /^[0-9A-F]{5}[A-Z]{5}[A-Z][0-9]{3}[0-9A-Z]{4}$/;

function checkCharacter(base: string): string {
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += CHARSET.indexOf(base[i]!) * (i + 1);
  return CHARSET[sum % 36]!;
}

function randomSuffix(): string {
  const array = new Uint32Array(3);
  globalThis.crypto.getRandomValues(array);
  let result = '';
  for (let i = 0; i < 3; i++) result += CHARSET[array[i]! % 36];
  return result;
}

export function generateEstateId(
  dateOfDeath: string | Date,
  firstName: string,
  lastName: string,
  sequenceNumber: number,
  isDummy = false,
): string {
  const diffHours = Math.floor((new Date(dateOfDeath).getTime() - EPOCH_MS) / 3_600_000);
  if (!Number.isFinite(diffHours) || diffHours < 0 || diffHours > 1048575) {
    throw new Error('Date of Death falls outside the 5-digit hex epoch limits.');
  }
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 0) throw new Error('Sequence must be a non-negative integer.');
  const timeHex = diffHours.toString(16).padStart(5, '0').toUpperCase();

  const clean = (s: string) => s.replace(/[^a-zA-Z]/g, '').toUpperCase();
  const slug = (clean(lastName).slice(0, 3) + clean(firstName).slice(0, 2)).padEnd(5, 'X');

  let seq: string;
  const digits = (sequenceNumber % 1000).toString().padStart(3, '0');
  if (isDummy) {
    seq = 'A' + digits;
  } else {
    const tier = Math.floor(sequenceNumber / 1000);
    if (tier > 24) throw new Error('Sequence capacity exceeded tier B limits.');
    seq = String.fromCharCode(90 - tier) + digits;
  }

  const base = timeHex + slug + seq + randomSuffix();
  return base.slice(0, 15) + checkCharacter(base) + base.slice(15);
}

export function isValidEstateId(id: string): boolean {
  if (!ESTATE_ID_PATTERN.test(id)) return false;
  const base = id.slice(0, 15) + id.slice(16);
  return checkCharacter(base) === id[15];
}
