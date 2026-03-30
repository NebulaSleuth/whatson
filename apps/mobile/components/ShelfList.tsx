import React, { useState, useCallback, useImperativeHandle, forwardRef, useEffect, useRef, useMemo } from 'react';
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

    useImperativeHandle(ref, () => ({
      focusFirst: () => {
        if (!isTV || sections.length === 0) return;
        setFocusTrigger((t) => t + 1);
      },
    }), [sections]);

    useEffect(() => {
      if (focusTrigger > 0) {
        focusTimerRef.current = setTimeout(() => setFocusTrigger(0), 300);
        return () => clearTimeout(focusTimerRef.current);
      }
    }, [focusTrigger]);

    // Pre-build stable onFirstCardRef callbacks per section to avoid inline closures
    const firstCardRefCallbacks = useMemo(() => {
      if (!isTV) return {};
      const cbs: Record<string, (nodeId: number) => void> = {};
      for (const section of sections) {
        cbs[section.id] = (nodeId: number) => handleFirstCardRef(section.id, nodeId);
      }
      return cbs;
    }, [sections, handleFirstCardRef]);

    return (
      <>
        {sections.map((section, index) => {
          const aboveSection = index > 0 ? sections[index - 1] : null;
          const belowSection = index < sections.length - 1 ? sections[index + 1] : null;

          return (
            <ContentShelf
              key={section.id}
              section={section}
              onItemPress={onItemPress}
              onRefresh={onRefresh}
              aboveFirstCardId={isTV && aboveSection ? firstCardIds[aboveSection.id] : undefined}
              belowFirstCardId={isTV && belowSection ? firstCardIds[belowSection.id] : undefined}
              onFirstCardRef={firstCardRefCallbacks[section.id]}
              focusFirstCard={index === 0 && focusTrigger > 0}
            />
          );
        })}
      </>
    );
  }
);
