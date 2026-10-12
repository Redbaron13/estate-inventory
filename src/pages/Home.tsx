import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { proposalView, roundView, summarize, exceptions } from '../../supabase/functions/_shared/domain.ts';
import { Icon } from '../components/Icon';
import { LinkRow, Notice } from '../components/ui';
import { useEstateData, useEstateId, useMe, useMeta, useMyMembership } from '../lib/hooks';

function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;
}

export default function Home() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const me = useMe();
  const membership = useMyMembership(data, me);
  const lastBackup = useMeta<string | null>(`last_backup:${estateId}`, null);
  const profile = useMeta<{ simplified_mode?: boolean } | null>('my_profile', null);

  const view = useMemo(() => {
    if (!data) return null;
    const s = summarize(data);
    const myVotes = data.proposals.map((p) => proposalView(p, data)).filter((v) => v.status === 'PENDING' && me && v.waitingOn.includes(me));
    const myChoices = data.grab_rounds
      .map((r) => roundView(r, data, me))
      // Still taking answers (open rounds, or sealed rounds before the reveal) and I have not answered.
      .filter((r) => !r.closed && !r.myClaim && (r.round.mode === 'OPEN' || r.sealed));
    const toFix = exceptions(data).length;
    return { s, myVotes, myChoices, toFix };
  }, [data, me]);

  if (!data || !view) return null;
  const { s } = view;
  const backupAge = daysSince(lastBackup);
  const simple = profile?.simplified_mode;
  const base = `/e/${estateId}`;

  return (
    <div>
      {(view.myVotes.length > 0 || view.myChoices.length > 0) && (
        <Link to={`${base}/decisions`} className="tone-progress mb-5 flex items-center gap-3 rounded-2xl p-4">
          <Icon name="hand" size={28} />
          <span className="flex-1">
            <b className="block">Your input is needed</b>
            <span>
              {[view.myVotes.length && `${view.myVotes.length} decision${view.myVotes.length > 1 ? 's' : ''} to approve or reject`,
                view.myChoices.length && `${view.myChoices.length} up-for-grabs item${view.myChoices.length > 1 ? 's' : ''} to answer`]
                .filter(Boolean).join(', ')}
            </span>
          </span>
          <Icon name="forward" />
        </Link>
      )}

      <Link to={`${base}/add`} className="btn btn-primary btn-block mb-3 min-h-16 text-lg">
        <Icon name="camera" size={26} /> Add an item
      </Link>
      {!simple && (
        <Link to={`${base}/scan`} className="btn btn-secondary btn-block mb-6">
          <Icon name="scan" /> Scan and put away
        </Link>
      )}

      <section className="panel mb-6 px-4" aria-label="Places to go">
        <LinkRow to={`${base}/items?filter=review`} icon="search" title="Review items" detail="Recorded but missing details or a decision" count={s.needsReview} />
        <LinkRow to={`${base}/items?filter=grabs`} icon="hand" title="Up for grabs" detail="Say whether you want something" count={s.upForGrabs} />
        <LinkRow to={`${base}/decisions`} icon="scale" title="Needs a decision" detail="Proposals waiting for approval" count={s.waitingApproval} />
        {!simple && <LinkRow to={`${base}/items?filter=valuable`} icon="star" title="Valuable or collectible" detail="Items flagged for a closer look" count={s.valuables} />}
        {!simple && <LinkRow to={`${base}/reports`} icon="file" title="Reports" detail="Inventory, values, who received what, history" />}
      </section>

      <section className="mb-6" aria-labelledby="progress">
        <h2 id="progress" className="mb-3">Progress</h2>
        <dl className="tabular divide-y divide-line border-y border-line">
          {[
            ['Items recorded', s.total],
            ['Need review', s.needsReview],
            ['Possibly valuable', s.valuables],
            ['Assigned or given to family', s.assigned],
            ['Sold or donated', s.soldOrDonated],
            ['Left the estate in total', s.leftEstate],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between py-2.5">
              <dt>{label}</dt>
              <dd className="text-lg font-bold">{value}</dd>
            </div>
          ))}
        </dl>
        {view.toFix > 0 && !simple && (
          <Link to={`${base}/reports?show=exceptions`} className="mt-3 inline-flex items-center gap-2 font-bold text-action">
            <Icon name="alert" size={18} /> {view.toFix} things to check in the exceptions report
          </Link>
        )}
      </section>

      {membership?.can_export !== false && (backupAge === null || backupAge >= 7) && (
        <Notice tone="attention" icon="cloud">
          {backupAge === null ? 'You have not saved a copy to your own iCloud or drive yet.' : `Your last saved copy is ${backupAge} days old.`}{' '}
          <Link to={`${base}/backup`} className="font-bold underline">Save a copy now</Link>
        </Notice>
      )}
    </div>
  );
}
