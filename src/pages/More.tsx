import { LinkRow } from '../components/ui';
import { DeviceOptions } from '../components/DeviceOptions';
import { InstallApp } from '../components/InstallApp';
import { APP_ENV, APP_VERSION, DEPLOYMENT_ID } from '../lib/config';
import { useEstateData, useEstateId, useMe, useMyMembership, useSyncState } from '../lib/hooks';

export default function More() {
  const estateId = useEstateId();
  const data = useEstateData(estateId);
  const me = useMe();
  const member = useMyMembership(data, me);
  const sync = useSyncState();
  const base = `/e/${estateId}`;
  return (
    <div>
      <h1 className="mb-5">More</h1>
      <nav className="panel mb-6 px-4" aria-label="More">
        <LinkRow to={`${base}/scan`} icon="scan" title="Batch inventory" detail="Scan or photograph many items into a list, set what they share, save them all" />
        <LinkRow to={`${base}/places`} icon="box" title="Places and labels" detail="Rooms, boxes, staging areas, printable QR labels" />
        {member?.can_export !== false && <LinkRow to={`${base}/reports`} icon="file" title="Reports" detail="Inventory, values, distribution, exceptions, history" />}
        {member?.can_export !== false && <LinkRow to={`${base}/backup`} icon="cloud" title="Save a copy" detail="To iCloud or your own drive; history check" />}
        <LinkRow to={`${base}/uploads`} icon="refresh" title="Upload queue" detail="What is still waiting to upload" count={sync.pending + sync.problems || undefined} />
        <LinkRow to={`${base}/family`} icon="users" title="Family and settings" detail="Members, invitations, approval rules, your profile" />
        <LinkRow to="/estates" icon="home" title="Switch estate" />
      </nav>
      <InstallApp />
      <DeviceOptions />
      <p className="text-[0.88rem] text-ink-soft">Estate Inventory {APP_VERSION} ({APP_ENV})<br />Deployment: <code>{DEPLOYMENT_ID}</code></p>
    </div>
  );
}

