import React, { useRef, useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, findNodeHandle } from 'react-native';
import type { ContentItem, ContentSection } from '@whatson/shared';
import { ContentCard } from './ContentCard';
import { ViewAllCard } from './ViewAllCard';
import { colors, spacing, typography, cardDimensions } from '@/constants/theme';
import { isTV } from '@/lib/tv';

/**
 * Sentinel id used by ContentShelf to append a trailing "View All" tile
 * when the section carries a viewAllRoute. Chosen so it can't collide
 * with any real ContentItem.id (which are always source-prefixed).
 */
const VIEW_ALL_SENTINEL = '__view-all__';

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
        listRef.current.scrollToOffset({ offset: 0, animated: false });
      } else {
        listRef.current.scrollToIndex({ index, animated: false, viewPosition: 0.3 });
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
    const list = section.items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    // Append the View All sentinel when the section has a route set —
    // renderItem swaps in a ViewAllCard for this id. Cast keeps the
    // FlatList data type ContentItem; the real ContentItem fields
    // aren't read for the sentinel.
    if (section.viewAllRoute) {
      list.push({ id: VIEW_ALL_SENTINEL } as ContentItem);
    }
    return list;
  }, [section.items, section.viewAllRoute]);

  const itemCount = items.length;

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => {
    if (item.id === VIEW_ALL_SENTINEL && section.viewAllRoute) {
      return (
        <ViewAllCard
          route={section.viewAllRoute}
          isLastInRow={index === itemCount - 1}
          nextFocusUp={aboveFirstCardId}
          nextFocusDown={belowFirstCardId}
        />
      );
    }
    return (
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
    );
  }, [onItemPress, onRefresh, handleCardFocus, handleCardBlur, itemCount, handleFirstCardMounted, aboveFirstCardId, belowFirstCardId, focusFirstCard, section.viewAllRoute]);

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
    // Shift a few dp of breathing room from below the title to above,
    // so shelves visually separate from the row above without pushing
    // the poster row further down.
    marginTop: isTV ? 6 : 0,
    marginBottom: isTV ? 2 : spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
});
