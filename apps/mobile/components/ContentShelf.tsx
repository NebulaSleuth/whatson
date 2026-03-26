import React, { useRef, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, findNodeHandle } from 'react-native';
import type { ContentItem, ContentSection } from '@whatson/shared';
import { ContentCard } from './ContentCard';
import { colors, spacing, typography, cardDimensions } from '@/constants/theme';
import { isTV } from '@/lib/tv';

interface ContentShelfProps {
  section: ContentSection;
  onItemPress?: (item: ContentItem) => void;
  onRefresh?: () => void;
  /** Node ID of the first card in the shelf above (for nextFocusUp) */
  aboveFirstCardId?: number;
  /** Node ID of the first card in the shelf below (for nextFocusDown) */
  belowFirstCardId?: number;
  /** Callback to report this shelf's first card node ID */
  onFirstCardRef?: (nodeId: number) => void;
  /** When true, set hasTVPreferredFocus on the first card */
  focusFirstCard?: boolean;
}

const TV_SHELF_HEIGHT = cardDimensions.poster.height + 60 + 40;

export function ContentShelf({
  section,
  onItemPress,
  onRefresh,
  aboveFirstCardId,
  belowFirstCardId,
  onFirstCardRef,
  focusFirstCard,
}: ContentShelfProps) {
  const listRef = useRef<FlatList>(null);

  const handleCardFocus = useCallback((index: number) => {
    if (isTV && listRef.current) {
      // Scroll to beginning if focusing the first card
      if (index === 0) {
        listRef.current.scrollToOffset({ offset: 0, animated: true });
      } else {
        listRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
      }
    }
  }, []);

  const handleFirstCardMounted = useCallback((ref: any) => {
    if (!isTV || !ref) return;
    const nodeId = findNodeHandle(ref);
    if (nodeId && onFirstCardRef) {
      onFirstCardRef(nodeId);
    }
  }, [onFirstCardRef]);

  return (
    <View style={[styles.container, isTV && { height: TV_SHELF_HEIGHT }]}>
      <Text style={styles.title}>{section.title}</Text>
      <FlatList
        ref={listRef}
        horizontal
        data={section.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <ContentCard
            item={item}
            onPress={onItemPress}
            onMarkWatched={onRefresh}
            onTVFocus={() => handleCardFocus(index)}
            isFirstInRow={index === 0}
            isLastInRow={index === section.items.length - 1}
            tvRef={index === 0 ? handleFirstCardMounted : undefined}
            nextFocusUp={aboveFirstCardId}
            nextFocusDown={belowFirstCardId}
            hasTVPreferredFocus={index === 0 && focusFirstCard}
          />
        )}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        snapToInterval={isTV ? undefined : cardDimensions.poster.width + spacing.md}
        decelerationRate="fast"
        windowSize={isTV ? 7 : 5}
        removeClippedSubviews={false}
        onScrollToIndexFailed={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: isTV ? spacing.md : spacing.xl,
  },
  title: {
    ...typography.sectionTitle,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
});
