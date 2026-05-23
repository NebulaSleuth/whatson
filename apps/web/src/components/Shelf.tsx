import { useEffect, useRef, useState } from 'react';
import type { ContentItem, ContentSection } from '@whatson/shared';
import { PosterCard } from './PosterCard';

interface Props {
  section: ContentSection;
  onItemClick?: (item: ContentItem) => void;
}

export function Shelf({ section, onItemClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      setAtStart(el.scrollLeft <= 1);
      // Tolerate sub-pixel rounding at the right edge.
      setAtEnd(el.scrollLeft >= maxScroll - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [section.items.length]);

  if (!section.items || section.items.length === 0) return null;

  // Convert vertical mouse-wheel ticks into horizontal scroll so a
  // standard desktop wheel can pan the shelf. Trackpad swipes already
  // emit deltaX, so we only redirect deltaY when deltaX is ~0.
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
      <h2 className="px-6 mb-3 text-lg font-semibold text-text">{section.title}</h2>
      <div
        ref={scrollRef}
        onWheel={onWheel}
        className="shelf-scroll flex gap-4 overflow-x-auto px-6 pb-2 scroll-smooth"
      >
        {section.items.map((item) => (
          <PosterCard key={item.id} item={item} onClick={onItemClick} />
        ))}
      </div>
      {!atStart && <ScrollButton direction="left" onClick={() => scrollBy(-1)} />}
      {!atEnd && <ScrollButton direction="right" onClick={() => scrollBy(1)} />}
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
