import React, { useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, findNodeHandle } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import type { ContentItem } from '@whatson/shared';
import { DetailSheet } from '@/components/DetailSheet';
import { ErrorState } from '@/components/ErrorState';
import { SourceBadge } from '@/components/SourceBadge';
import { ProgressBar } from '@/components/ProgressBar';
import { TVPressable } from '@/components/TVFocusable';
import { api, resolveArtworkUrl } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { colors, spacing, typography, cardDimensions } from '@/constants/theme';

type LibraryType = 'show' | 'movie';

const NUM_COLUMNS = isTV ? 7 : 3;

// Simple card for the library grid — no complex focus props
const LibraryCard = React.memo(function LibraryCard({
  item, focused, onPress, onFocus,
}: {
  item: ContentItem; focused: boolean;
  onPress: () => void; onFocus: () => void;
}) {
  return (
    <Pressable
      style={[styles.card, isTV && focused && styles.cardFocused]}
      onPress={onPress}
      onFocus={onFocus}
      focusable={true}
    >
      <View style={[styles.posterContainer, isTV && focused && styles.posterFocused]}>
        <Image
          source={{ uri: resolveArtworkUrl(item.artwork.poster) }}
          style={styles.poster}
          contentFit="cover"
          cachePolicy="disk"
          transition={isTV ? 0 : 200}
        />
        <ProgressBar percentage={item.progress.percentage} />
        <View style={styles.badgeContainer}>
          <SourceBadge source={item.source} />
        </View>
      </View>
      <Text style={[styles.cardTitle, isTV && focused && styles.cardTitleFocused]} numberOfLines={1}>
        {item.showTitle || item.title}
      </Text>
      {item.year > 0 && (
        <Text style={styles.cardYear}>{item.year}</Text>
      )}
    </Pressable>
  );
});

export default function LibraryScreen() {
  const [type, setType] = useState<LibraryType>('show');
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef<FlatList>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['library', type],
    queryFn: () => api.getLibrary(type),
  });

  const handleItemPress = useCallback((item: ContentItem) => {
    setSelectedItem(item);
  }, []);

  const handleFocus = useCallback((index: number) => {
    setFocusedIndex(index);
    // Scroll to keep focused item visible
    if (isTV && listRef.current) {
      const row = Math.floor(index / NUM_COLUMNS);
      listRef.current.scrollToIndex({
        index: row * NUM_COLUMNS,
        animated: true,
        viewPosition: 0.3,
      });
    }
  }, []);

  const items = data || [];

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <LibraryCard
      item={item}
      focused={focusedIndex === index}
      onPress={() => handleItemPress(item)}
      onFocus={() => handleFocus(index)}
    />
  ), [focusedIndex, handleItemPress, handleFocus]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
        <Text style={styles.headerCount}>
          {items.length > 0 ? `${items.length} titles` : ''}
        </Text>
      </View>

      <View style={styles.toggleRow}>
        <TVPressable
          style={[styles.toggleChip, type === 'show' && styles.toggleChipActive]}
          onPress={() => { setType('show'); setFocusedIndex(-1); }}
        >
          <Text style={[styles.toggleText, type === 'show' && styles.toggleTextActive]}>
            TV Shows
          </Text>
        </TVPressable>
        <TVPressable
          style={[styles.toggleChip, type === 'movie' && styles.toggleChipActive]}
          onPress={() => { setType('movie'); setFocusedIndex(-1); }}
        >
          <Text style={[styles.toggleText, type === 'movie' && styles.toggleTextActive]}>
            Movies
          </Text>
        </TVPressable>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : (
        <FlatList
          ref={listRef}
          key={`library-${type}-${NUM_COLUMNS}`}
          data={items}
          numColumns={NUM_COLUMNS}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.grid}
          removeClippedSubviews={false}
          maxToRenderPerBatch={isTV ? 28 : 12}
          windowSize={isTV ? 9 : 5}
          initialNumToRender={isTV ? 35 : 15}
          onScrollToIndexFailed={() => {}}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                No {type === 'show' ? 'TV shows' : 'movies'} in your library
              </Text>
            </View>
          }
        />
      )}

      {selectedItem && (
        <DetailSheet
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onRefresh={() => refetch()}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: spacing.lg,
    paddingTop: isTV ? spacing.sm : spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    ...typography.title,
  },
  headerCount: {
    ...typography.caption,
  },
  toggleRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  toggleChip: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  toggleChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  toggleText: {
    fontSize: isTV ? 16 : 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  toggleTextActive: {
    color: '#000',
  },
  grid: {
    paddingHorizontal: spacing.md,
  },
  card: {
    width: isTV
      ? `${Math.floor(100 / NUM_COLUMNS)}%` as any
      : `${Math.floor(100 / NUM_COLUMNS)}%` as any,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.lg,
  },
  cardFocused: {
    zIndex: 10,
  },
  posterContainer: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  posterFocused: {
    borderColor: colors.focus,
    borderRadius: 10,
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  badgeContainer: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
  },
  cardTitle: {
    ...typography.caption,
    color: colors.text,
    marginTop: spacing.xs,
  },
  cardTitleFocused: {
    color: colors.focus,
  },
  cardYear: {
    ...typography.caption,
    fontSize: isTV ? 11 : 10,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    paddingTop: 60,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
  },
});
