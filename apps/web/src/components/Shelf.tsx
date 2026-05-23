import type { ContentItem, ContentSection } from '@whatson/shared';
import { PosterCard } from './PosterCard';

interface Props {
  section: ContentSection;
  onItemClick?: (item: ContentItem) => void;
}

export function Shelf({ section, onItemClick }: Props) {
  if (!section.items || section.items.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="px-6 mb-3 text-lg font-semibold text-text">{section.title}</h2>
      <div className="shelf-scroll flex gap-4 overflow-x-auto px-6 pb-2">
        {section.items.map((item) => (
          <PosterCard key={item.id} item={item} onClick={onItemClick} />
        ))}
      </div>
    </section>
  );
}
