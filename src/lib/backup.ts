// "Save to iCloud": builds a complete, self-explanatory backup file on the
// phone (works offline) and opens the share sheet, where the person chooses
// Save to Files > iCloud Drive (or Google Drive, OneDrive, email...).
// A web app cannot write to iCloud on its own; this is the reliable path.
import { zip, strToU8, type Zippable } from 'fflate';
import { categoryLabel } from '../../supabase/functions/_shared/codes.ts';
import {
  STATUS_LABELS, byId, formatMoney, isLiveItem, locationPath, referenceValue,
  type EstateData, type LedgerEntry,
} from '../../supabase/functions/_shared/domain.ts';
import { sha256Hex } from '../../supabase/functions/_shared/ledger.ts';
import {
  activityReport, distributionReport, exceptionsReport, inventoryReport, toCSV, valuationReport,
} from '../../supabase/functions/_shared/reports.ts';
import { api } from './api';
import { APP_VERSION, MEDIA_BUCKET } from './config';
import { db, getMeta, loadEstateData } from './db';
import { supabase } from './supabase';

export interface BackupOptions {
  includeFullPhotos: boolean;
  onProgress?: (message: string) => void;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function smallThumb(blob: Blob): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 220 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

/** A single HTML page that opens on any phone or computer, with no app needed. */
async function readableHtml(data: EstateData, generatedAt: string, fingerprint: string | null): Promise<string> {
  const locs = byId(data.locations);
  const items = data.items.filter(isLiveItem).sort((a, b) => a.inventory_number - b.inventory_number);
  const rows: string[] = [];
  for (const i of items) {
    const m = data.media.find((x) => x.item_id === i.id && x.thumb_sha256);
    const blob = m ? await db.blobs.get(m.thumb_sha256!) : undefined;
    const img = blob ? await smallThumb(blob.blob) : null;
    const ref = referenceValue(i.id, data.valuations);
    rows.push(`<tr>
      <td>${img ? `<img src="${img}" alt="">` : ''}</td>
      <td><b>#${i.inventory_number}</b><br><code>${esc(i.item_code)}</code></td>
      <td><b>${esc(i.title)}</b>${i.description ? `<br>${esc(i.description)}` : ''}<br><small>${esc(categoryLabel(i.category))}${i.quantity > 1 ? `, quantity ${i.quantity}` : ''}</small></td>
      <td>Found: ${esc(locationPath(i.original_location_id, locs))}<br>Now: ${esc(locationPath(i.current_location_id, locs))}</td>
      <td>${esc(STATUS_LABELS[i.status])}</td>
      <td>${ref ? esc(formatMoney(ref.amount)) : ''}</td>
    </tr>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(data.estate?.name)} inventory</title>
<style>body{font:16px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a2733;margin:16px}h1{font-size:22px}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #d5dbd6;padding:8px;vertical-align:top;text-align:left}img{width:88px;border-radius:4px}code{font-size:13px}small{color:#4f5d6a}</style></head><body>
<h1>${esc(data.estate?.name)}</h1>
<p>${items.length} items. Saved ${esc(new Date(generatedAt).toLocaleString())}.${fingerprint ? ` History fingerprint: <code>${esc(fingerprint)}</code>.` : ''}</p>
<table><thead><tr><th>Photo</th><th>Number</th><th>Item</th><th>Place</th><th>Status</th><th>Value</th></tr></thead><tbody>${rows.join('')}</tbody></table>
</body></html>`;
}

const README = (name: string, when: string) => `Estate Inventory backup
=======================

Estate: ${name}
Saved: ${when}

Open inventory.html in any browser to read the inventory with photos.

data/            Full records as JSON, plus CSV files that open in Excel or Numbers.
photos/thumbs/   Small photos of every item that was on this phone.
photos/full/     Full-size photos (only if you chose to include them).
manifest.json    The SHA-256 fingerprint of every file in this backup and the
                 estate's history fingerprint at the time it was saved.

Every photo's file name ends with the start of its fingerprint, so it can be
matched to the copies kept in the estate's cloud storage and locked backup.
`;

export async function buildBackup(estateId: string, opts: BackupOptions): Promise<File> {
  const say = opts.onProgress ?? (() => undefined);
  say('Gathering records…');
  const data = await loadEstateData(estateId);
  const generatedAt = new Date().toISOString();
  const head = await getMeta<{ estate_seq: number; hash: string } | null>(`head:${estateId}`, null);
  const witness = await db.witnesses.where('estate_id').equals(estateId).last();

  let ledger: LedgerEntry[] | null = null;
  if (navigator.onLine) {
    try {
      say('Downloading the full history…');
      ledger = [];
      let after = 0;
      for (let guard = 0; guard < 100; guard++) {
        const page = await api<{ entries: LedgerEntry[] }>(`/estates/${estateId}/ledger?after_seq=${after}&limit=2000`);
        ledger.push(...page.entries);
        if (page.entries.length < 2000) break;
        after = page.entries[page.entries.length - 1].estate_seq;
      }
    } catch {
      ledger = null;
    }
  }

  const files: Zippable = {};
  const manifest: { path: string; sha256: string; bytes: number }[] = [];
  const add = async (path: string, bytes: Uint8Array, level: 0 | 6 = 6) => {
    files[path] = [bytes, { level }];
    manifest.push({ path, sha256: await sha256Hex(bytes), bytes: bytes.length });
  };

  const name = data.estate?.name ?? 'Estate';
  await add('README.txt', strToU8(README(name, new Date(generatedAt).toLocaleString())));
  await add('data/estate.json', strToU8(JSON.stringify({ format: 'estate-inventory-backup', version: 1, generated_at: generatedAt, app_version: APP_VERSION, data }, null, 1)));
  await add('data/inventory.csv', strToU8(toCSV(inventoryReport(data))));
  await add('data/valuation.csv', strToU8(toCSV(valuationReport(data))));
  await add('data/distribution.csv', strToU8(toCSV(distributionReport(data))));
  await add('data/exceptions.csv', strToU8(toCSV(exceptionsReport(data))));
  if (ledger) {
    await add('data/history.json', strToU8(JSON.stringify(ledger)));
    await add('data/activity.csv', strToU8(toCSV(activityReport(ledger, data))));
  }

  say('Adding photos…');
  const itemNum = new Map(data.items.map((i) => [i.id, i.inventory_number]));
  const redacted = new Set(data.redactions.map((r) => r.media_id));
  let missingFull = 0;
  for (const m of data.media) {
    if (redacted.has(m.id)) continue;
    const prefix = `${String(itemNum.get(m.item_id ?? '') ?? 'x').padStart(4, '0')}-${m.sha256.slice(0, 10)}`;
    if (m.thumb_sha256) {
      const t = await db.blobs.get(m.thumb_sha256);
      if (t) await add(`photos/thumbs/${prefix}.jpg`, new Uint8Array(await t.blob.arrayBuffer()), 0);
    }
    if (opts.includeFullPhotos) {
      let full = (await db.blobs.get(m.sha256))?.blob;
      if (!full && navigator.onLine) {
        const { data: dl } = await supabase.storage.from(MEDIA_BUCKET).download(m.storage_path);
        full = dl ?? undefined;
      }
      if (full) await add(`photos/full/${prefix}.${m.storage_path.split('.').pop()}`, new Uint8Array(await full.arrayBuffer()), 0);
      else missingFull++;
    }
  }

  say('Writing the readable copy…');
  await add('inventory.html', strToU8(await readableHtml(data, generatedAt, head?.hash ?? null)));
  files['manifest.json'] = strToU8(JSON.stringify({
    generated_at: generatedAt, app_version: APP_VERSION, estate_id: estateId, estate_name: name,
    history_head: head, verified_on_this_phone: witness ?? null, full_photos_missing: missingFull, files: manifest,
  }, null, 1));

  say('Compressing…');
  const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(files, (err, out) => (err ? reject(err) : resolve(out))));
  const safe = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'Estate';
  return new File([bytes as BlobPart], `${safe}-backup-${generatedAt.slice(0, 10)}.zip`, { type: 'application/zip' });
}

export { saveFile, blobFile, type SaveOutcome } from './files';
