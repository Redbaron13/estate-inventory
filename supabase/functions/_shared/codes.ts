// Human-readable codes for items and places. Pure TypeScript with no
// runtime-specific imports, so the web app (Vite) and the API (Deno) share it.
// The database implements the same rules (see the foundation migration) and
// rejects anything that does not match.
//
// Item code:      0428KB-LR7FUR-Q3X
//   0428  inventory number (4+ digits)     KB   member who entered it
//   LR    room where it was found          7    check digit
//   FUR   category                         Q3X  random (Crockford base32)
// Location code:  BOX-9Q4TR  (kind prefix, 2 random, check digit, 2 random)
//
// Check digit = sum(position * value) mod 11 over every other character in
// reading order (0-9 = 0-9, A-Z = 10-35, positions from 1). A result of 10 is
// never used: the random part is redrawn instead.

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const CATEGORIES = [
  { code: 'FUR', label: 'Furniture' },
  { code: 'APL', label: 'Appliances' },
  { code: 'KIT', label: 'Kitchen and dining' },
  { code: 'CHN', label: 'China, glass and crystal' },
  { code: 'JWL', label: 'Jewelry and watches' },
  { code: 'ART', label: 'Art and frames' },
  { code: 'DEC', label: 'Decor and lamps' },
  { code: 'BKS', label: 'Books and media' },
  { code: 'DOC', label: 'Papers and documents' },
  { code: 'MEM', label: 'Photos and keepsakes' },
  { code: 'CLO', label: 'Clothing and accessories' },
  { code: 'LIN', label: 'Linens and textiles' },
  { code: 'ELE', label: 'Electronics' },
  { code: 'TLS', label: 'Tools and hardware' },
  { code: 'OUT', label: 'Garden and outdoor' },
  { code: 'SPT', label: 'Sports and hobbies' },
  { code: 'TOY', label: 'Toys and games' },
  { code: 'COL', label: 'Coins, stamps and cards' },
  { code: 'MUS', label: 'Musical instruments' },
  { code: 'VEH', label: 'Vehicles' },
  { code: 'MSC', label: 'Other / not sure' },
] as const;

export type CategoryCode = (typeof CATEGORIES)[number]['code'];
export const CATEGORY_CODES: readonly string[] = CATEGORIES.map((c) => c.code);

export function categoryLabel(code: string | null | undefined): string {
  return CATEGORIES.find((c) => c.code === code)?.label ?? 'Other / not sure';
}

export type LocationKind = 'PROPERTY' | 'AREA' | 'CONTAINER' | 'STAGING' | 'HOLDING' | 'PERSON' | 'EXTERNAL';

export const LOCATION_PREFIX: Record<LocationKind, string> = {
  PROPERTY: 'PRP',
  AREA: 'RM',
  CONTAINER: 'BOX',
  STAGING: 'STG',
  HOLDING: 'HLD',
  PERSON: 'PER',
  EXTERNAL: 'EXT',
};

const ITEM_CODE_RE = /^([0-9]{4,})([A-Z]{2})-([A-Z0-9]{2})([0-9])([A-Z]{3})-([0-9A-HJKMNP-TV-Z]{3})$/;
const LOCATION_CODE_RE = /^(PRP|RM|BOX|STG|HLD|PER|EXT)-([0-9A-HJKMNP-TV-Z]{2})([0-9])([0-9A-HJKMNP-TV-Z]{2})$/;

function charValue(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) return c - 48; // 0-9
  if (c >= 65 && c <= 90) return c - 55; // A-Z
  throw new Error(`Invalid code character "${ch}"`);
}

/** Weighted mod-11 check value over letters and digits (0-10). */
export function checkDigit(body: string): number {
  const chars = body.toUpperCase().replace(/[^0-9A-Z]/g, '');
  let sum = 0;
  for (let i = 0; i < chars.length; i++) sum += (i + 1) * charValue(chars[i]);
  return sum % 11;
}

type RandomSource = (length: number) => Uint8Array;
const defaultRandom: RandomSource = (length) => crypto.getRandomValues(new Uint8Array(length));

export function randomCode(length: number, random: RandomSource = defaultRandom): string {
  const bytes = random(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % 32];
  return out;
}

export function formatInventoryNumber(n: number): string {
  const s = String(n);
  return s.length >= 4 ? s : s.padStart(4, '0');
}

export interface ItemCodeParts {
  inventoryNumber: number;
  memberCode: string;
  foundTag: string;
  category: string;
}

export function makeItemCode(parts: ItemCodeParts, random: RandomSource = defaultRandom): string {
  const num = formatInventoryNumber(parts.inventoryNumber);
  const member = parts.memberCode.toUpperCase();
  const tag = (parts.foundTag || 'XX').toUpperCase();
  const cat = parts.category.toUpperCase();
  if (!/^[A-Z]{2}$/.test(member)) throw new Error('Member code must be 2 letters');
  if (!/^[A-Z0-9]{2}$/.test(tag)) throw new Error('Room tag must be 2 letters or digits');
  if (!CATEGORY_CODES.includes(cat)) throw new Error(`Unknown category ${cat}`);
  for (;;) {
    const rand = randomCode(3, random);
    const check = checkDigit(num + member + tag + cat + rand);
    if (check < 10) return `${num}${member}-${tag}${check}${cat}-${rand}`;
  }
}

export interface ParsedItemCode extends ItemCodeParts {
  code: string;
  check: number;
  random: string;
}

/** Accepts codes with or without dashes or spaces, in any case. */
export function parseItemCode(input: string): ParsedItemCode | null {
  const compact = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  // Fixed widths from the end: random(3), category(3), check(1), tag(2), member(2); the rest is the number.
  if (compact.length < 15) return null;
  const n = compact.length;
  const withDashes = `${compact.slice(0, n - 9)}-${compact.slice(n - 9, n - 3)}-${compact.slice(n - 3)}`;
  const m = ITEM_CODE_RE.exec(withDashes);
  if (!m) return null;
  const [, num, member, tag, check, cat, rand] = m;
  if (checkDigit(num + member + tag + cat + rand) !== Number(check)) return null;
  return {
    code: withDashes,
    inventoryNumber: Number(num),
    memberCode: member,
    foundTag: tag,
    check: Number(check),
    category: cat,
    random: rand,
  };
}

export function isValidItemCode(code: string): boolean {
  return parseItemCode(code)?.code === code.toUpperCase();
}

export function makeLocationCode(kind: LocationKind, random: RandomSource = defaultRandom): string {
  const prefix = LOCATION_PREFIX[kind];
  for (;;) {
    const rand = randomCode(4, random);
    const check = checkDigit(prefix + rand);
    if (check < 10) return `${prefix}-${rand.slice(0, 2)}${check}${rand.slice(2)}`;
  }
}

export function parseLocationCode(input: string): { code: string; kind: LocationKind } | null {
  const compact = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = /^(PRP|RM|BOX|STG|HLD|PER|EXT)([0-9A-HJKMNP-TV-Z]{2})([0-9])([0-9A-HJKMNP-TV-Z]{2})$/.exec(compact);
  if (!m) return null;
  const [, prefix, a, check, b] = m;
  if (checkDigit(prefix + a + b) !== Number(check)) return null;
  const kind = (Object.keys(LOCATION_PREFIX) as LocationKind[]).find((k) => LOCATION_PREFIX[k] === prefix)!;
  return { code: `${prefix}-${a}${check}${b}`, kind };
}

export function isValidLocationCode(code: string): boolean {
  return LOCATION_CODE_RE.test(code) && parseLocationCode(code)?.code === code;
}

const TAG_STOPWORDS = new Set(['THE', 'A', 'AN', 'OF', 'AND', 'S']);

/**
 * Two-character room tag from a name: "Living room" -> LR, "Bedroom 2" -> B2,
 * "Kitchen" -> KT. Avoids tags already in use where possible (best effort;
 * tags are hints for people, not identifiers). Mirrors private.derive_location_tag.
 */
export function deriveLocationTag(name: string, usedTags: Iterable<string> = []): string {
  const used = new Set(usedTags);
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !TAG_STOPWORDS.has(w));
  if (words.length === 0) words.push('XX');
  const first = words[0];
  const last = words[words.length - 1];
  const cons = first.slice(1).replace(/[AEIOU]/g, '');
  const cands: string[] = [];
  if (words.length >= 2) cands.push(first[0] + last[0]);
  if (cons) cands.push(first[0] + cons[0]);
  cands.push((first + 'X').slice(0, 2));
  for (let i = 1; i < Math.min(cons.length, 6); i++) cands.push(first[0] + cons[i]);
  for (let i = 2; i <= 9; i++) cands.push(first[0] + String(i));
  for (const c of cands) {
    if (/^[A-Z0-9]{2}$/.test(c) && c !== 'XX' && !used.has(c)) return c;
  }
  return (first + 'X').slice(0, 2);
}

export type ScanResult =
  | { type: 'item'; code: string; parsed: ParsedItemCode }
  | { type: 'location'; code: string; kind: LocationKind }
  | { type: 'barcode'; value: string };

/** Classify anything scanned or typed: our item label, our place label, or a product barcode. */
export function classifyScan(raw: string): ScanResult {
  const value = raw.trim();
  const loc = parseLocationCode(value);
  if (loc) return { type: 'location', code: loc.code, kind: loc.kind };
  const item = parseItemCode(value);
  if (item) return { type: 'item', code: item.code, parsed: item };
  return { type: 'barcode', value };
}
