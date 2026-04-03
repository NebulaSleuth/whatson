import React, { useRef, useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, findNodeHandle } from 'react-native';
import type { ContentItem, ContentSection } from '@whatson/shared';
import { ContentCard } from './ContentCard';
import { colors, spacing, typography, cardDimensions } from '@/constants/theme';
import { isTV } from '@/lib/tv';

interface ContentShelfProps {
  section: ContentSection;
  onItemPress?: (item: ContentItem) => void;
  onRefresh?: () => void;
  aboveFirstCardId?: number;
  belowFirstCardId?: number;
  onFirstCardRef?: (nodeId: number) => void;
  focusFirstCard?: boolean;
}

const TV_SHELF_HEIGHT = cardDimensions.poster.height + 60 + 40;

const keyExtractor = (item: ContentItem) => item.id;

export const ContentShelf = React.memo(function ContentShelf({
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
      if (index === 0) {
        listRef.current.scrollToOffset({ offset: 0, animated: true });
      } else {
        listRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
      }
    }
  }, []);

  const handleCardBlur = useCallback(() => {}, []);

  const handleFirstCardMounted = useCallback((ref: any) => {
    if (!isTV || !ref) return;
    const nodeId = findNodeHandle(ref);
    if (nodeId && onFirstCardRef) {
      onFirstCardRef(nodeId);
    }
  }, [onFirstCardRef]);

  // Deduplicate items by id to prevent "two children with the same key" errors
  const items = useMemo(() => {
    const seen = new Set<string>();
    return section.items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [section.items]);

  const itemCount = items.length;

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <ContentCard
      item={item}
      onPress={onItemPress}
      onMarkWatched={onRefresh}
      onTVFocus={() => handleCardFocus(index)}
      onTVBlur={handleCardBlur}
      isFirstInRow={index === 0}
      isLastInRow={index === itemCount - 1}
      tvRef={index === 0 ? handleFirstCardMounted : undefined}
      nextFocusUp={aboveFirstCardId}
      nextFocusDown={belowFirstCardId}
      hasTVPreferredFocus={index === 0 && focusFirstCard}
    />
  ), [onItemPress, onRefresh, handleCardFocus, handleCardBlur, itemCount, handleFirstCardMounted, aboveFirstCardId, belowFirstCardId, focusFirstCard]);

  return (
    <View style={[styles.container, isTV && tvContainerStyle]}>
      <Text style={styles.title}>{section.title}</Text>
      <FlatList
        ref={listRef}
        horizontal
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        snapToInterval={isTV ? undefined : cardDimensions.poster.width + spacing.md}
        decelerationRate="fast"
        windowSize={isTV ? 11 : 5}
        maxToRenderPerBatch={isTV ? 8 : 5}
        initialNumToRender={isTV ? 7 : 5}
        removeClippedSubviews={false}
        updateCellsBatchingPeriod={isTV ? 100 : 50}
        onScrollToIndexFailed={() => {}}
      />
    </View>
  );
});

const tvContainerStyle = { height: TV_SHELF_HEIGHT };

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
