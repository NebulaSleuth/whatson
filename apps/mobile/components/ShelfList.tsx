import React, { useState, useCallback, useImperativeHandle, forwardRef, useEffect, useRef } from 'react';
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
    const [focusTrigger, setFocusTrigger] = useState(0);
    const focusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
        // Increment trigger to activate hasTVPreferredFocus on first card
        setFocusTrigger((t) => t + 1);
      },
    }), [sections]);

    // Reset the focus trigger after a short delay so it can fire again
    useEffect(() => {
      if (focusTrigger > 0) {
        focusTimerRef.current = setTimeout(() => setFocusTrigger(0), 300);
        return () => clearTimeout(focusTimerRef.current);
      }
    }, [focusTrigger]);

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
              focusFirstCard={index === 0 && focusTrigger > 0}
            />
          );
        })}
      </>
    );
  }
);
