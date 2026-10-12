import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isLiveItem, type LedgerEntry } from '../../supabase/functions/_shared/domain.ts';
import {
  activityReport, distributionReport, exceptionsReport, inventoryReport, toCSV, valuationReport, type Table,
} from '../../supabase/functions/_shared/reports.ts';
import { Icon } from '../components/Icon';
import { ErrorText, Notice, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { blobFile, saveFile } from '../lib/files';
import { useEstateData, useEstateId, useMe, useMeta, useMyMembership, useOnline } from '../lib/hooks';
import { itemLabelsPdf, tableToPdf } from '../lib/pdf';
import type { EstateData } from '../../supabase/functions/_shared/domain.ts';

type ReportKey = 'inventory' | 'valuation' | 'distribution' | 'exceptions' | 'activity';

const REPORTS: { key: ReportKey; title: string; detail: string; needsOnline?: boolean }[] = [
  { key: 'inventory', title: 'Inventory', detail: 'Every item with photo, place, condition, status, value, who it is assigned to, and what finally happened.' },
  { key: 'valuation', title: 'Values', detail: 'Totals kept separate: family estimates, outside estimates, appraisals, sale proceeds, donation values.' },
  { key: 'distribution', title: 'Who received what', detail: 'Grouped by family member, with assigned values, transfer dates, receipts, and who approved.' },
  { key: 'exceptions', title: 'Exceptions', detail: 'Missing photos or values, items removed without approval, pending decisions, conflicting claims, possible duplicates.' },
  { key: 'activity', title: 'Activity history', detail: 'Every change in order, with who made it. Needs a connection to download the full history.', needsOnline: true },
];

async function buildTable(key: ReportKey, data: EstateData, estateId: string): Promise<Table> {
  switch (key) {
    case 'inventory': return inventoryReport(data);
    case 'valuation': return valuationReport(data);
    case 'distribution': return distributionReport(data);
    case 'exceptions': return exceptionsReport(data);
    case 'activity': {
      const entries: LedgerEntry[] = [];
      let after = 0;
      for (let guard = 0; guard < 100; guard++) {
        const page = await api<{ entries: LedgerEntry[] }>(`/estates/${estateId}/ledger?after_seq=${after}&limit=2000`);
        entries.push(...page.entries);
        if (page.entries.length < 2000) break;
        after = page.entries[page.entries.length - 1].estate_seq;
      }
      return activityReport(entries, data);
    }
  }
}

export default function Reports() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const me = useMe();
  const member = useMyMembership(data, me);
  const online = useOnline();
  const head = useMeta<{ hash: string } | null>(`head:${estateId}`, null);
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Table | null>(null);

  if (!data) return null;
  if (member && !member.can_export) return <Notice tone="neutral" icon="lock">Your role in this estate does not include reports.</Notice>;
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = (data.estate?.name ?? 'estate').replace(/[^A-Za-z0-9]+/g, '-');

  async function run(key: ReportKey, format: 'pdf' | 'csv' | 'view') {
    setBusy(`Preparing the ${key} report…`);
    setError(null);
    try {
      const table = await buildTable(key, data!, estateId);
      if (format === 'view') setPreview(table);
      else if (format === 'csv') await saveFile(blobFile(new Blob([toCSV(table)], { type: 'text/csv' }), `${safeName}-${key}-${stamp}.csv`, 'text/csv'));
      else await saveFile(blobFile(await tableToPdf(table, data!, { thumbnails: key === 'inventory', historyFingerprint: head?.hash ?? null }), `${safeName}-${key}-${stamp}.pdf`, 'application/pdf'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const live = data.items.filter(isLiveItem);

  return (
    <div>
      <PageHeader title="Reports" back={`/e/${estateId}/more`} />
      <p className="mb-5 text-ink-soft">Reports are made on this phone from the latest synced records, so they work offline. PDFs give a stable record for the family or an attorney; CSV files open in Excel or Numbers.</p>
      {busy && <p className="mb-4"><Spinner label={busy} /></p>}
      <ErrorText error={error} />
      <ul className="mb-8 space-y-4">
        {REPORTS.map((r) => (
          <li key={r.key} className={`panel p-4 ${params.get('show') === r.key ? 'ring-2 ring-[var(--focus)]' : ''}`}>
            <h2 className="mb-1">{r.title}</h2>
            <p className="mb-3 text-ink-soft">{r.detail}</p>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" className="btn btn-secondary" disabled={!!busy || (r.needsOnline && !online)} onClick={() => void run(r.key, 'view')}><Icon name="eye" size={18} /> View</button>
              <button type="button" className="btn btn-secondary" disabled={!!busy || (r.needsOnline && !online)} onClick={() => void run(r.key, 'pdf')}><Icon name="file" size={18} /> PDF</button>
              <button type="button" className="btn btn-secondary" disabled={!!busy || (r.needsOnline && !online)} onClick={() => void run(r.key, 'csv')}><Icon name="download" size={18} /> CSV</button>
            </div>
          </li>
        ))}
      </ul>

      <section className="panel mb-6 p-4">
        <h2 className="mb-1">Item labels</h2>
        <p className="mb-3 text-ink-soft">QR labels for every item ({live.length}), on standard 30-per-sheet address labels.</p>
        <button type="button" className="btn btn-secondary btn-block" onClick={() => void saveFile(blobFile(itemLabelsPdf(live.sort((a, b) => a.inventory_number - b.inventory_number), data.locations), `${safeName}-item-labels.pdf`, 'application/pdf'))}>
          <Icon name="tag" /> Print all item labels
        </button>
      </section>

      {preview && (
        <section aria-labelledby="preview-h">
          <h2 id="preview-h" className="mb-3">{preview.title}</h2>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[0.9rem]">
              <thead className="bg-sunk text-left"><tr>{preview.headers.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {preview.rows.slice(0, 300).map((row, i) => (
                  <tr key={i} className="border-t border-line">{row.map((c, j) => <td key={j} className="px-3 py-2 align-top">{String(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 300 && <p className="mt-2 text-ink-soft">Showing the first 300 rows. The PDF and CSV include everything.</p>}
        </section>
      )}
    </div>
  );
}
