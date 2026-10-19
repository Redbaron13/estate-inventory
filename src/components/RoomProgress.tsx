import { Link } from 'react-router-dom';
import { byId, isLiveItem, locationChain, type EstateData } from '../../supabase/functions/_shared/domain.ts';
export function RoomProgress({ data, estateId }: { data: EstateData; estateId: string }) {
  const places = byId(data.locations);
  const rooms = data.locations.filter(l => l.kind === 'AREA' && !l.archived_at);
  if (!rooms.length) return <p className="workflow-hint mb-5 text-ink-soft">Start by adding your bedrooms, kitchen, living room and storage areas in <Link className="font-bold underline" to={`/e/${estateId}/places`}>Places and labels</Link>. Room names are yours to choose.</p>;
  const items = data.items.filter(isLiveItem);
  return <section className="mb-6" aria-labelledby="rooms-heading">
    <div className="mb-3 flex items-center justify-between gap-3"><h2 id="rooms-heading">Work room by room</h2><Link className="font-bold text-action" to={`/e/${estateId}/places`}>Manage rooms</Link></div>
    <p className="workflow-hint mb-3 text-ink-soft">Counts show what you have recorded, not whether a room is finished. Open a room to review its items.</p>
    <ul className="room-list divide-y divide-line border-y border-line">
      {rooms.map(room => {
        const found = items.filter(i => locationChain(i.original_location_id, places).some(l => l.id === room.id));
        const review = found.filter(i => ['DISCOVERED', 'NEEDS_IDENTIFICATION', 'NEEDS_VALUATION', 'NEEDS_DECISION'].includes(i.status)).length;
        return <li key={room.id}><Link className="flex min-h-16 items-center justify-between gap-3 py-3" to={`/e/${estateId}/items?place=${room.id}`}><b>{room.name}</b><span className="text-right text-ink-soft">{found.length} recorded<span className="block text-sm">{review} to review</span></span></Link></li>;
      })}
    </ul>
  </section>;
}
