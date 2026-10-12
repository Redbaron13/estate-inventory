// PDFs generated on the phone (so they work offline): reports for the family
// or an attorney, and sheets of QR labels for items and places.
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { EstateData, Item, Location } from '../../supabase/functions/_shared/domain.ts';
import { byId, locationPath } from '../../supabase/functions/_shared/domain.ts';
import type { Table } from '../../supabase/functions/_shared/reports.ts';
import { db } from './db';
import { blobToDataUrl } from './images';
import { qrMatrix } from './qr';

const INK: [number, number, number] = [29, 58, 87];

function header(doc: jsPDF, title: string, estateName: string) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(title, 40, 44);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(80, 90, 100);
  doc.text(`${estateName}. Generated ${new Date().toLocaleString()}.`, 40, 60);
}

function footer(doc: jsPDF, note: string) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(110, 118, 126);
    const h = doc.internal.pageSize.getHeight();
    doc.text(note, 40, h - 22);
    doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.getWidth() - 40, h - 22, { align: 'right' });
  }
}

/** A report table as PDF. Inventory gets photo thumbnails in the first column. */
export async function tableToPdf(table: Table, data: EstateData, opts: { thumbnails?: boolean; historyFingerprint?: string | null } = {}): Promise<Blob> {
  const landscape = table.headers.length > 7;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' });
  header(doc, table.title, data.estate?.name ?? 'Estate');

  let thumbs: Map<number, string> = new Map();
  if (opts.thumbnails) {
    const redacted = new Set(data.redactions.map((r) => r.media_id));
    for (const item of data.items) {
      const m = data.media.find((x) => x.item_id === item.id && x.thumb_sha256 && !redacted.has(x.id));
      if (!m) continue;
      const blob = await db.blobs.get(m.thumb_sha256!);
      if (blob) thumbs.set(item.inventory_number, await blobToDataUrl(blob.blob));
    }
  } else {
    thumbs = new Map();
  }

  const head = opts.thumbnails ? [['Photo', ...table.headers]] : [table.headers];
  const body = table.rows.map((r) => (opts.thumbnails ? ['', ...r.map(String)] : r.map(String)));
  autoTable(doc, {
    startY: 72,
    head,
    body,
    styles: { font: 'helvetica', fontSize: landscape ? 7.5 : 9, cellPadding: 3, overflow: 'linebreak', textColor: [30, 40, 50] },
    headStyles: { fillColor: INK, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [244, 246, 243] },
    columnStyles: opts.thumbnails ? { 0: { cellWidth: 44, minCellHeight: 40 } } : {},
    margin: { left: 40, right: 40, bottom: 40 },
    didDrawCell: (hook) => {
      if (!opts.thumbnails || hook.section !== 'body' || hook.column.index !== 0) return;
      const num = Number(table.rows[hook.row.index]?.[0]);
      const url = thumbs.get(num);
      if (url) {
        try {
          hook.doc.addImage(url, 'JPEG', hook.cell.x + 2, hook.cell.y + 2, 38, 36, undefined, 'FAST');
        } catch {
          /* skip unreadable image */
        }
      }
    },
  });
  footer(doc, opts.historyFingerprint ? `History fingerprint: ${opts.historyFingerprint}` : 'Estate Inventory');
  return doc.output('blob');
}

function drawQr(doc: jsPDF, text: string, x: number, y: number, size: number) {
  const m = qrMatrix(text);
  const cell = size / m.size;
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      // A hair of overlap (1% of a module) hides seams between modules in PDF viewers.
      if (m.isDark(r, c)) doc.rect(x + c * cell, y + r * cell, cell * 1.01, cell * 1.01, 'F');
    }
  }
}

function fit(doc: jsPDF, text: string, width: number): string {
  if (doc.getTextWidth(text) <= width) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > width) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Item labels on US Letter address-label sheets (Avery 5160 layout:
 * 3 across, 10 down, 2.625" x 1"). Each label: QR, code, description, place found.
 */
export function itemLabelsPdf(items: Item[], locations: Location[]): Blob {
  const doc = new jsPDF({ unit: 'in', format: 'letter' });
  const locs = byId(locations);
  const W = 2.625, H = 1, left = 0.1875, top = 0.5, gapX = 0.125;
  items.forEach((item, i) => {
    const pos = i % 30;
    if (i > 0 && pos === 0) doc.addPage();
    const col = pos % 3, row = Math.floor(pos / 3);
    const x = left + col * (W + gapX), y = top + row * H;
    drawQr(doc, item.item_code, x + 0.08, y + 0.1, 0.8);
    doc.setFont('courier', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(0, 0, 0);
    doc.text(item.item_code, x + 0.95, y + 0.27);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(fit(doc, `#${item.inventory_number} ${item.title}`, W - 1.05), x + 0.95, y + 0.48);
    doc.setTextColor(90, 90, 90);
    doc.setFontSize(7);
    doc.text(fit(doc, `Found: ${locationPath(item.original_location_id, locs)}`, W - 1.05), x + 0.95, y + 0.66);
  });
  return doc.output('blob');
}

/**
 * Place labels for rooms, boxes and staging areas (Avery 5163 layout:
 * 2 across, 5 down, 4" x 2"). Big QR so it scans from arm's length.
 */
export function placeLabelsPdf(places: Location[], all: Location[]): Blob {
  const doc = new jsPDF({ unit: 'in', format: 'letter' });
  const locs = byId(all);
  const W = 4, H = 2, left = 0.156, top = 0.5, gapX = 0.188;
  places.forEach((loc, i) => {
    const pos = i % 10;
    if (i > 0 && pos === 0) doc.addPage();
    const col = pos % 2, row = Math.floor(pos / 2);
    const x = left + col * (W + gapX), y = top + row * H;
    drawQr(doc, loc.code, x + 0.15, y + 0.2, 1.6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text(fit(doc, loc.name, W - 2.0), x + 1.9, y + 0.55);
    doc.setFont('courier', 'bold');
    doc.setFontSize(14);
    doc.text(loc.code, x + 1.9, y + 0.9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(70, 70, 70);
    const path = locationPath(loc.parent_id, locs);
    if (loc.parent_id) doc.text(fit(doc, `In: ${path}`, W - 2.0), x + 1.9, y + 1.2);
    if (loc.purpose) doc.text(fit(doc, loc.purpose, W - 2.0), x + 1.9, y + 1.45);
  });
  return doc.output('blob');
}
