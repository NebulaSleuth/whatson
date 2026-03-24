import React, { useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ContentItem } from '@whatson/shared';
import { DetailSheet } from '@/components/DetailSheet';
import { ErrorState } from '@/components/ErrorState';
import { TVPressable } from '@/components/TVFocusable';
import { api, resolveArtworkUrl } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { colors, spacing, typography } from '@/constants/theme';

type LibraryType = 'show' | 'movie';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const GRID_PADDING = spacing.md * 2;

// On TV: calculate card size to fit exactly 2 rows
// Use screen height directly — tab bar is 56px, header+toggle ~90px
const TV_CHROME = 56 + 90; // tab bar + header + toggle + margins
const TV_GRID_H = SCREEN_HEIGHT - TV_CHROME;
const TV_CARD_MARGIN = spacing.md; // marginBottom per card
const TV_TITLE_H = 20 + spacing.xs; // title text + marginTop
const TV_BORDER = 6;
const TV_ROW_H = Math.floor(TV_GRID_H / 2);
const TV_POSTER_H = TV_ROW_H - TV_CARD_MARGIN - TV_TITLE_H - TV_BORDER;
const TV_POSTER_W = Math.floor(TV_POSTER_H / 1.5); // maintain 2:3 ratio
const TV_ITEM_W = TV_POSTER_W + spacing.xs * 2 + TV_BORDER;
const NUM_COLUMNS = isTV ? Math.max(1, Math.floor((SCREEN_WIDTH - GRID_PADDING) / TV_ITEM_W)) : 3;
const ITEM_WIDTH = isTV ? Math.floor((SCREEN_WIDTH - GRID_PADDING) / NUM_COLUMNS) : Math.floor((SCREEN_WIDTH - GRID_PADDING) / NUM_COLUMNS);

const LibraryCard = React.memo(function LibraryCard({
  item, width, posterHeight, focused, onPress, onFocus,
}: {
  item: ContentItem; width: number; posterHeight?: number; focused: boolean;
  onPress: () => void; onFocus: () => void;
}) {
  // If posterHeight is set, derive width from it to maintain 2:3 ratio
  // Otherwise derive height from width
  const maxPw = width - spacing.xs * 2;
  const ph = posterHeight || Math.floor(maxPw * 1.5);
  const pw = posterHeight ? Math.min(Math.floor(ph / 1.5), maxPw) : maxPw;

  return (
    <Pressable
      style={[cardStyles.container, { width }]}
      onPress={onPress}
      onFocus={onFocus}
      focusable={true}
      android_ripple={isTV ? null : undefined}
    >
      <View style={[cardStyles.poster, { width: pw, height: ph }, focused && cardStyles.posterFocused]}>
        <Image
          source={{ uri: resolveArtworkUrl(item.artwork.poster) }}
          style={cardStyles.image}
          contentFit="cover"
          cachePolicy="disk"
          transition={0}
        />
      </View>
      <Text style={[cardStyles.title, focused && cardStyles.titleFocused]} numberOfLines={1}>
        {item.showTitle || item.title}
      </Text>
    </Pressable>
  );
});

const cardStyles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md,
  },
  poster: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  posterFocused: {
    borderColor: colors.focus,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  title: {
    ...typography.caption,
    color: colors.text,
    marginTop: spacing.xs,
  },
  titleFocused: {
    color: colors.focus,
  },
});

export default function LibraryScreen() {
  const [type, setType] = useState<LibraryType>('show');
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const currentRowRef = useRef(0);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['library', type],
    queryFn: () => api.getLibrary(type),
  });

  const items = data || [];

  const handleItemPress = useCallback((item: ContentItem) => {
    setSelectedItem(item);
  }, []);

  // On TV: when a card gets focus, snap scroll to show full rows
  const handleCardFocus = useCallback((item: ContentItem, index: number) => {
    setFocusedId(item.id);

    if (isTV && listRef.current) {
      const row = Math.floor(index / NUM_COLUMNS);
      if (row !== currentRowRef.current) {
        currentRowRef.current = row;
        // Snap to show 2 full rows starting from the row above the focused one
        const topRow = Math.max(0, row - 1);
        const scrollY = topRow * TV_ROW_H;
        // Use a short delay to override Android TV's native scroll
        setTimeout(() => {
          listRef.current?.scrollToOffset({ offset: scrollY, animated: false });
        }, 50);
      }
    }
  }, []);

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <LibraryCard
      item={item}
      width={ITEM_WIDTH}
      posterHeight={isTV ? TV_POSTER_H : undefined}
      focused={focusedId === item.id}
      onPress={() => handleItemPress(item)}
      onFocus={() => handleCardFocus(item, index)}
    />
  ), [handleItemPress, focusedId, handleCardFocus]);

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
          onPress={() => { setType('show'); setFocusedId(null); }}
        >
          <Text style={[styles.toggleText, type === 'show' && styles.toggleTextActive]}>
            TV Shows
          </Text>
        </TVPressable>
        <TVPressable
          style={[styles.toggleChip, type === 'movie' && styles.toggleChipActive]}
          onPress={() => { setType('movie'); setFocusedId(null); }}
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
          windowSize={isTV ? 11 : 5}
          maxToRenderPerBatch={isTV ? 35 : 12}
          initialNumToRender={isTV ? 35 : 15}
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
    paddingBottom: isTV ? 100 : 40,
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
