import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isLiveItem, type EstateData, type LedgerEntry } from '../../supabase/functions/_shared/domain.ts';
import {
  activityReport, distributionReport, exceptionsReport, inventoryReport, toCSV, valuationReport, type Table,
} from '../../supabase/functions/_shared/reports.ts';
import { useFileSaver } from '../components/FileSaver';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorText, LinkRow, Notice, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { blobFile } from '../lib/files';
import { useEstateData, useEstateId, useMe, useMeta, useMyMembership, useOnline, useSyncState } from '../lib/hooks';

// Reports are built on the phone from its synced copy of the estate, so they
// work offline (except the full activity history, which comes from the server
// so that it is complete). The same builders produce the API's CSV exports.

type ReportKey = 'inventory' | 'valuation' | 'distribution' | 'exceptions' | 'activity';

interface ReportDef { key: ReportKey; title: string; detail: string; needsOnline?: boolean }

export const REPORTS: ReportDef[] = [
  { key: 'inventory', title: 'Inventory', detail: 'Every item with its place, condition, status, value, who it is assigned to, and what finally happened.' },
  { key: 'valuation', title: 'Values', detail: 'Totals kept separate: family estimates, outside estimates, appraisals, sale proceeds, donation values.' },
  { key: 'distribution', title: 'Who received what', detail: 'By family member: items, assigned values, transfer dates, receipts, and who approved.' },
  { key: 'exceptions', title: 'Exceptions', detail: 'Missing photos or values, items removed without approval, pending decisions, conflicting requests, possible duplicates.' },
  { key: 'activity', title: 'Activity history', detail: 'Every change in order, with who made it and its fingerprint. Needs a connection.', needsOnline: true },
];

function buildLocal(key: ReportKey, data: EstateData): Table | null {
  switch (key) {
    case 'inventory': return inventoryReport(data);
    case 'valuation': return valuationReport(data);
    case 'distribution': return distributionReport(data);
    case 'exceptions': return exceptionsReport(data);
    default: return null;
  }
}

async function buildActivity(estateId: string, data: EstateData): Promise<Table> {
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

const fileStamp = () => new Date().toISOString().slice(0, 10);
const safeName = (data: EstateData) => (data.estate?.name ?? 'estate').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------------------
// Report list
// ---------------------------------------------------------------------------
export default function Reports() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const me = useMe();
  const member = useMyMembership(data, me);
  const saver = useFileSaver();
  const [busy, setBusy] = useState(false);

  if (!data) return null;
  if (member && !member.can_export) return <Notice tone="neutral" icon="lock">Your role in this estate does not include reports.</Notice>;
  const live = data.items.filter(isLiveItem).sort((a, b) => a.inventory_number - b.inventory_number);

  async function labels() {
    setBusy(true);
    try {
      const { itemLabelsPdf } = await import('../lib/pdf');
      await saver.deliver(blobFile(itemLabelsPdf(live, data!.locations), `${safeName(data!)}-item-labels.pdf`, 'application/pdf'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Reports" back={`/e/${estateId}/more`} />
      <p className="mb-5 text-ink-soft">Open a report to read it here, then save it as a PDF for the family or an attorney, or as a spreadsheet for Excel or Numbers.</p>
      <nav aria-label="Reports" className="panel mb-6 px-3">
        {REPORTS.map((r) => (
          <LinkRow key={r.key} to={`/e/${estateId}/reports/${r.key}`} icon={r.key === 'activity' ? 'history' : r.key === 'valuation' ? 'dollar' : r.key === 'distribution' ? 'users' : r.key === 'exceptions' ? 'alert' : 'file'} title={r.title} detail={r.detail} />
        ))}
      </nav>

      <section className="panel mb-6 p-4" aria-labelledby="labels-h">
        <h2 id="labels-h" className="mb-1">Item labels</h2>
        <p className="mb-3 text-ink-soft">A QR label for every item ({live.length}), on standard 30-per-sheet address labels (Avery 5160 layout).</p>
        <button type="button" className="btn btn-secondary btn-block" disabled={busy || !live.length} onClick={() => void labels()}>
          {busy ? <Spinner label="Preparing labels" /> : <><Icon name="tag" /> Print all item labels</>}
        </button>
        {saver.panel}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One report
// ---------------------------------------------------------------------------
interface Card { title: string; subtitle?: string; fields: [string, string][]; total?: boolean }

const blank = (v: unknown) => v === '' || v === null || v === undefined;

/** How a row reads as a card on a phone (wide reports only). */
function toCard(key: ReportKey, headers: string[], row: (string | number)[]): Card {
  const v = (i: number) => String(row[i] ?? '');
  const rest = (from: number[], skip: number[] = []) =>
    from.filter((i) => !skip.includes(i) && !blank(row[i])).map((i) => [headers[i], v(i)] as [string, string]);
  const all = headers.map((_, i) => i);
  switch (key) {
    case 'inventory':
      return { title: `#${v(0)} ${v(2)}`, subtitle: v(1), fields: rest(all, [0, 1, 2]) };
    case 'distribution':
      if (blank(row[1])) return { title: v(0), fields: [['Total assigned value', v(4)]], total: true };
      return { title: `#${v(1)} ${v(3)}`, subtitle: v(0), fields: rest(all, [0, 1, 3]) };
    case 'exceptions':
      return { title: v(0), subtitle: `#${v(1)} ${v(3)}`, fields: rest(all, [0, 1, 3]) };
    case 'activity':
      return { title: v(3), subtitle: `${v(2)}, ${v(1)} UTC`, fields: [['Entry', v(0)], ['Fingerprint', v(4)]] };
    default:
      return { title: v(0), fields: rest(all, [0]) };
  }
}

const MAX_ROWS = 300;

export function ReportDetail() {
  const estateId = useEstateId();
  const { reportKey } = useParams();
  const def = REPORTS.find((r) => r.key === reportKey);
  const data = useEstateData(estateId);
  const me = useMe();
  const member = useMyMembership(data, me);
  const online = useOnline();
  const { lastSyncAt } = useSyncState();
  const head = useMeta<{ hash: string } | null>(`head:${estateId}`, null);
  const saver = useFileSaver();
  const [activity, setActivity] = useState<Table | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = def?.key;
  const local = useMemo(() => (data && key ? buildLocal(key, data) : null), [data, key]);

  useEffect(() => {
    if (key !== 'activity' || !online || !data) return;
    let cancelled = false;
    setError(null);
    buildActivity(estateId, data)
      .then((t) => { if (!cancelled) setActivity(t); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
    // The history only needs fetching once per visit; data changes do not require a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, online, estateId, !!data]);

  if (!def) return <EmptyState icon="file" title="Report not found" action={<Link className="btn btn-secondary" to={`/e/${estateId}/reports`}>All reports</Link>} />;
  if (!data) return null;
  if (member && !member.can_export) return <Notice tone="neutral" icon="lock">Your role in this estate does not include reports.</Notice>;

  const table = def.key === 'activity' ? activity : local;
  const name = `${safeName(data)}-${def.key}-${fileStamp()}`;

  async function savePdf() {
    if (!table) return;
    setBusy('Preparing the PDF');
    setError(null);
    try {
      const { tableToPdf } = await import('../lib/pdf');
      const pdf = await tableToPdf(table, data!, { thumbnails: def!.key === 'inventory', historyFingerprint: head?.hash ?? null });
      await saver.deliver(blobFile(pdf, `${name}.pdf`, 'application/pdf'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveCsv() {
    if (!table) return;
    setError(null);
    await saver.deliver(blobFile(new Blob([toCSV(table)], { type: 'text/csv' }), `${name}.csv`, 'text/csv'));
  }

  const wide = (table?.headers.length ?? 0) > 4;
  const rows = table?.rows ?? [];

  return (
    <div>
      <PageHeader title={def.title} back={`/e/${estateId}/reports`} />
      <p className="mb-4 text-ink-soft">
        {def.key === 'activity' ? 'From the shared history on the server.' : `From the records on this phone${lastSyncAt ? `, last synced ${new Date(lastSyncAt).toLocaleString()}` : ''}.`}
        {table && ` ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}.`}
      </p>
      {def.needsOnline && !online && <Notice tone="attention" icon="cloudOff">The activity history needs a connection. The other reports work offline.</Notice>}

      <div className="mb-2 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-primary" disabled={!table || !!busy} onClick={() => void savePdf()}>
          <Icon name="file" size={18} /> Save PDF
        </button>
        <button type="button" className="btn btn-secondary" disabled={!table || !!busy} onClick={() => void saveCsv()}>
          <Icon name="download" size={18} /> Spreadsheet
        </button>
      </div>
      {busy && <p className="mt-2"><Spinner label={busy} /></p>}
      {saver.panel}
      <ErrorText error={error} />

      <div className="mt-5">
        {!table && !error && (online || def.key !== 'activity') && <Spinner label="Building the report" />}
        {table && rows.length === 0 && <EmptyState icon="check" title="Nothing to report yet">{def.key === 'exceptions' ? 'No open issues.' : 'This report fills in as the family records items and decisions.'}</EmptyState>}

        {table && rows.length > 0 && !wide && (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[0.95rem]">
              <thead className="bg-sunk text-left"><tr>{table.headers.map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, MAX_ROWS).map((row, i) => (
                  <tr key={i} className="border-t border-line">{row.map((c, j) => <td key={j} className={`px-3 py-2 align-top ${typeof c === 'number' || /^[\d$,.]+$/.test(String(c)) ? 'tabular text-right' : ''}`}>{String(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {table && rows.length > 0 && wide && (
          <ul className="space-y-3" aria-label={`${def.title} report`}>
            {rows.slice(0, MAX_ROWS).map((row, i) => {
              const card = toCard(def.key, table.headers, row);
              return (
                <li key={i} className={`panel p-4 ${card.total ? 'bg-sunk' : ''}`}>
                  <p className="font-bold">{card.title}</p>
                  {card.subtitle && <p className="text-[0.92rem] text-ink-soft">{card.subtitle}</p>}
                  {card.fields.length > 0 && (
                    <dl className="mt-2 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 text-[0.92rem]">
                      {card.fields.map(([label, value]) => (
                        <div key={label} className="contents">
                          <dt className="text-ink-soft">{label}</dt>
                          <dd className={label === 'Fingerprint' || label === 'Item code' ? 'code break-all' : ''}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > MAX_ROWS && <p className="mt-3 text-ink-soft">Showing the first {MAX_ROWS} rows. The PDF and spreadsheet include all {rows.length}.</p>}
      </div>
    </div>
  );
}
