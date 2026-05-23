import type { SportsEvent } from '@whatson/shared';
import { SportsCard } from './SportsCard';

interface Props {
  title: string;
  events: SportsEvent[];
  onItemClick?: (event: SportsEvent) => void;
}

export function SportsShelf({ title, events, onItemClick }: Props) {
  if (events.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="px-6 mb-3 text-lg font-semibold text-text">{title}</h2>
      <div className="shelf-scroll flex gap-4 overflow-x-auto px-6 pb-2">
        {events.map((event) => (
          <SportsCard key={event.id} event={event} onClick={onItemClick} />
        ))}
      </div>
    </section>
  );
}
