import React, { useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { UIManager, Platform } from 'react-native';
import type { ContentItem, ContentSection } from '@whatson/shared';
import { ContentShelf } from './ContentShelf';
import { isTV } from '@/lib/tv';

interface ShelfListProps {
  sections: ContentSection[];
  onItemPress?: (item: ContentItem) => void;
  onRefresh?: () => void;
}

export interface ShelfListHandle {
  focusFirst: () => void;
}

export const ShelfList = forwardRef<ShelfListHandle, ShelfListProps>(
  function ShelfList({ sections, onItemPress, onRefresh }, ref) {
    const [firstCardIds, setFirstCardIds] = useState<Record<string, number>>({});

    const handleFirstCardRef = useCallback((sectionId: string, nodeId: number) => {
      setFirstCardIds((prev) => {
        if (prev[sectionId] === nodeId) return prev;
        return { ...prev, [sectionId]: nodeId };
      });
    }, []);

    // Expose focusFirst to parent via ref
    useImperativeHandle(ref, () => ({
      focusFirst: () => {
        if (!isTV || sections.length === 0) return;
        const firstSectionId = sections[0].id;
        const nodeId = firstCardIds[firstSectionId];
        if (nodeId && Platform.OS === 'android') {
          try {
            UIManager.updateView(nodeId, 'RCTView', { hasTVPreferredFocus: true });
          } catch {}
        }
      },
    }), [sections, firstCardIds]);

    return (
      <>
        {sections.map((section, index) => {
          const aboveSection = index > 0 ? sections[index - 1] : null;
          const belowSection = index < sections.length - 1 ? sections[index + 1] : null;

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
);
