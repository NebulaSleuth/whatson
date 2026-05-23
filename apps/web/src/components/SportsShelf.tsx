import { useRef } from 'react';
import type { SportsEvent } from '@whatson/shared';
import { SportsCard } from './SportsCard';

interface Props {
  title: string;
  events: SportsEvent[];
  onItemClick?: (event: SportsEvent) => void;
}

export function SportsShelf({ title, events, onItemClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  if (events.length === 0) return null;

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }

  function scrollBy(direction: 1 | -1) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 600), behavior: 'smooth' });
  }

  return (
    <section className="mb-8 group/shelf relative">
      <h2 className="px-6 mb-3 text-lg font-semibold text-text">{title}</h2>
      <div
        ref={scrollRef}
        onWheel={onWheel}
        className="shelf-scroll flex gap-4 overflow-x-auto px-6 pb-2 scroll-smooth"
      >
        {events.map((event) => (
          <SportsCard key={event.id} event={event} onClick={onItemClick} />
        ))}
      </div>
      <ScrollButton direction="left" onClick={() => scrollBy(-1)} />
      <ScrollButton direction="right" onClick={() => scrollBy(1)} />
    </section>
  );
}

function ScrollButton({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
  const sideClass = direction === 'left' ? 'left-2' : 'right-2';
  const glyph = direction === 'left' ? '‹' : '›';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Scroll ${direction}`}
      className={[
        'absolute top-1/2 -translate-y-1/2',
        sideClass,
        'w-10 h-16 rounded bg-black/70 text-white text-3xl font-bold',
        'opacity-0 group-hover/shelf:opacity-100 transition-opacity',
        'hover:bg-primary hover:text-black',
        'focus:opacity-100 focus:outline-none',
      ].join(' ')}
    >
      {glyph}
    </button>
  );
}
