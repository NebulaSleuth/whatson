import type { ContentItem } from '@whatson/shared';
import { PosterCard } from './PosterCard';

interface Props {
  items: ContentItem[];
  onItemClick?: (item: ContentItem) => void;
  emptyMessage?: string;
}

export function Grid({ items, onItemClick, emptyMessage = 'No items.' }: Props) {
  if (items.length === 0) {
    return <p className="text-text-muted px-6 py-10">{emptyMessage}</p>;
  }
  return (
    <div className="grid gap-4 px-6 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
      {items.map((item) => (
        <PosterCard key={item.id} item={item} onClick={onItemClick} />
      ))}
    </div>
  );
}
