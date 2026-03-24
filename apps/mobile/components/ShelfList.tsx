import React, { useState, useCallback } from 'react';
import type { ContentItem, ContentSection } from '@whatson/shared';
import { ContentShelf } from './ContentShelf';
import { isTV } from '@/lib/tv';

interface ShelfListProps {
  sections: ContentSection[];
  onItemPress?: (item: ContentItem) => void;
  onRefresh?: () => void;
}

/**
 * Renders multiple ContentShelf components and wires up cross-shelf
 * focus navigation on TV. When pressing up/down, focus goes to the
 * first card of the adjacent shelf.
 */
export function ShelfList({ sections, onItemPress, onRefresh }: ShelfListProps) {
  // Track the first card node ID for each shelf by section id
  const [firstCardIds, setFirstCardIds] = useState<Record<string, number>>({});

  const handleFirstCardRef = useCallback((sectionId: string, nodeId: number) => {
    setFirstCardIds((prev) => {
      if (prev[sectionId] === nodeId) return prev;
      return { ...prev, [sectionId]: nodeId };
    });
  }, []);

  return (
    <>
      {sections.map((section, index) => {
        const aboveSection = index > 0 ? sections[index - 1] : null;
        const belowSection = index < sections.length - 1 ? sections[index + 1] : null;

        // For the first shelf, trap upward focus to its own first card
        // This prevents Android TV from jumping to a random tab based on proximity
        const aboveId = isTV
          ? (aboveSection ? firstCardIds[aboveSection.id] : firstCardIds[section.id])
          : undefined;

        return (
          <ContentShelf
            key={section.id}
            section={section}
            onItemPress={onItemPress}
            onRefresh={onRefresh}
            aboveFirstCardId={aboveId}
            belowFirstCardId={isTV && belowSection ? firstCardIds[belowSection.id] : undefined}
            onFirstCardRef={isTV ? (nodeId) => handleFirstCardRef(section.id, nodeId) : undefined}
          />
        );
      })}
    </>
  );
}
