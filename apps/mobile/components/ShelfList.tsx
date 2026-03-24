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

        // For shelves with a shelf above, point up to the above shelf's first card
        // For the first shelf, don't override nextFocusUp — let it reach the tab bar
        const aboveId = isTV && aboveSection
          ? firstCardIds[aboveSection.id]
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
