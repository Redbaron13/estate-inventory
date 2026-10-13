// Deterministic estate code: EST-[YYYY]-[HEX_8]. Uses Web Crypto so it runs in
// the browser, Deno and Node 20+. The payload is a caller-chosen stable string
// triple; the app uses the estate id as the first part so no SSN data is held.
export interface EstateCodePayload {
  decedentSsnHash: string;
  jurisdictionCode: string;
  createdAtTimestamp: number;
}

export const ESTATE_CODE_PATTERN = /^EST-\d{4}-[0-9A-F]{8}$/;

export async function generateEstateCode(payload: EstateCodePayload): Promise<string> {
  const year = new Date(payload.createdAtTimestamp).getUTCFullYear();
  const raw = `${payload.decedentSsnHash}:${payload.jurisdictionCode}:${payload.createdAtTimestamp}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `EST-${year}-${hex.slice(0, 8).toUpperCase()}`;
}

export function isValidEstateCode(code: string): boolean {
  return ESTATE_CODE_PATTERN.test(code);
}
