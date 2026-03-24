import React, { useState, useCallback } from 'react';
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

const NUM_COLUMNS = isTV ? 7 : 3;
const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_PADDING = spacing.md * 2;
const ITEM_WIDTH = Math.floor((SCREEN_WIDTH - GRID_PADDING) / NUM_COLUMNS);

const LibraryCard = React.memo(function LibraryCard({
  item, width, posterHeight, focused, onPress, onFocus,
}: {
  item: ContentItem; width: number; posterHeight?: number; focused: boolean;
  onPress: () => void; onFocus: () => void;
}) {
  const pw = width - spacing.xs * 2;
  const ph = posterHeight || Math.floor(pw * 1.5);

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

// Card margin/title/border overhead per row
const CARD_OVERHEAD = spacing.xs + 20 + 6 + spacing.md; // marginTop title + title height + border + marginBottom

export default function LibraryScreen() {
  const [type, setType] = useState<LibraryType>('show');
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [gridHeight, setGridHeight] = useState(0);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['library', type],
    queryFn: () => api.getLibrary(type),
  });

  const items = data || [];

  // Calculate poster height to fit exactly 2 rows on TV
  const tvPosterHeight = isTV && gridHeight > 0
    ? Math.floor((gridHeight / 2) - CARD_OVERHEAD)
    : undefined;

  const handleItemPress = useCallback((item: ContentItem) => {
    setSelectedItem(item);
  }, []);

  const renderItem = useCallback(({ item }: { item: ContentItem }) => (
    <LibraryCard
      item={item}
      width={ITEM_WIDTH}
      posterHeight={tvPosterHeight}
      focused={focusedId === item.id}
      onPress={() => handleItemPress(item)}
      onFocus={() => setFocusedId(item.id)}
    />
  ), [handleItemPress, focusedId]);

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
        <View style={{ flex: 1 }} onLayout={(e) => {
          if (isTV && gridHeight === 0) setGridHeight(e.nativeEvent.layout.height);
        }}>
        <FlatList
          key={`library-${type}-${NUM_COLUMNS}-${tvPosterHeight || 0}`}
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
        </View>
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
