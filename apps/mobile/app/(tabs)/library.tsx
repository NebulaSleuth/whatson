import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ContentItem } from '@whatson/shared';
import { DetailSheet } from '@/components/DetailSheet';
import { ErrorState } from '@/components/ErrorState';
import { TVPressable } from '@/components/TVFocusable';
import { api, resolveArtworkUrl } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { useTVBackHandler } from '@/lib/useBackHandler';
import { colors, spacing, typography, cardDimensions } from '@/constants/theme';

type LibraryType = 'show' | 'movie';
type SortField = 'alpha' | 'added' | 'release' | 'watched';
type SortDir = 'asc' | 'desc';

const SORT_LABELS: Record<SortField, string> = {
  alpha: 'A-Z',
  added: 'Date Added',
  release: 'Release Year',
  watched: 'Last Watched',
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_PADDING = spacing.md * 2;

// Use shared card dimensions from theme for consistency with shelves
const TV_POSTER_W = cardDimensions.poster.width;
const TV_POSTER_H = cardDimensions.poster.height;
const TV_CARD_MARGIN = spacing.md; // marginBottom per card
const TV_TITLE_H = 20 + spacing.xs; // title text + marginTop
const TV_BORDER = 6;
const TV_ITEM_W = TV_POSTER_W + spacing.xs * 2 + TV_BORDER;
const TV_ROW_H = TV_POSTER_H + TV_CARD_MARGIN + TV_TITLE_H + TV_BORDER;
const NUM_COLUMNS = isTV ? Math.max(1, Math.floor((SCREEN_WIDTH - GRID_PADDING) / TV_ITEM_W)) : 3;
const ITEM_WIDTH = Math.floor((SCREEN_WIDTH - GRID_PADDING) / NUM_COLUMNS);

const LibraryCard = React.memo(function LibraryCard({
  item, width, posterHeight, onPress, onFocus, hasTVPreferredFocus,
}: {
  item: ContentItem; width: number; posterHeight?: number;
  onPress: () => void; onFocus: () => void; hasTVPreferredFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);

  // If posterHeight is set, derive width from it to maintain 2:3 ratio
  // Otherwise derive height from width
  const maxPw = width - spacing.xs * 2;
  const ph = posterHeight || Math.floor(maxPw * 1.5);
  const pw = posterHeight ? Math.min(Math.floor(ph / 1.5), maxPw) : maxPw;

  return (
    <Pressable
      style={[cardStyles.container, { width }]}
      onPress={onPress}
      onFocus={() => { setFocused(true); onFocus(); }}
      onBlur={() => setFocused(false)}
      focusable={true}
      android_ripple={isTV ? null : undefined}
      {...(hasTVPreferredFocus ? { hasTVPreferredFocus: true } : {})}
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
  const [sortField, setSortField] = useState<SortField>('alpha');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const listRef = useRef<FlatList>(null);
  const currentRowRef = useRef(0);
  const [focusTrigger, setFocusTrigger] = useState(0);

  // Reset focus trigger after a short delay so it can fire again
  useEffect(() => {
    if (focusTrigger > 0) {
      const timer = setTimeout(() => setFocusTrigger(0), 300);
      return () => clearTimeout(timer);
    }
  }, [focusTrigger]);

  useTVBackHandler(useCallback(() => {
    console.log('[Library] back handler fired');
    currentRowRef.current = 0;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    // Trigger hasTVPreferredFocus on the first card
    setFocusTrigger((t) => t + 1);
    return true;
  }, []));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['library', type],
    queryFn: () => api.getLibrary(type),
  });

  const items = useMemo(() => {
    const raw = data || [];
    const sorted = [...raw].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'alpha': {
          const tA = (a.showTitle || a.title).toLowerCase();
          const tB = (b.showTitle || b.title).toLowerCase();
          cmp = tA.localeCompare(tB);
          break;
        }
        case 'added':
          cmp = new Date(a.addedAt || 0).getTime() - new Date(b.addedAt || 0).getTime();
          break;
        case 'release':
          cmp = (a.year || 0) - (b.year || 0);
          break;
        case 'watched':
          cmp = new Date(a.lastViewedAt || 0).getTime() - new Date(b.lastViewedAt || 0).getTime();
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [data, sortField, sortDir]);

  const handleItemPress = useCallback((item: ContentItem) => {
    if (type === 'show') {
      console.log('[Library] navigating to show-detail: ratingKey=' + item.sourceId + ' title=' + (item.showTitle || item.title));
      router.navigate({
        pathname: '/show-detail',
        params: {
          ratingKey: item.sourceId,
          title: item.showTitle || item.title,
          poster: item.artwork.poster,
          summary: item.summary || '',
          year: String(item.year || ''),
        },
      } as any);
    } else {
      setSelectedItem(item);
    }
  }, [type]);

  // On TV: when a card gets focus, snap scroll to show full rows
  // Use a ref so renderItem doesn't depend on this callback's identity
  const listRefStable = listRef;
  const handleCardFocus = useCallback((_item: ContentItem, index: number) => {
    if (isTV && listRefStable.current) {
      const row = Math.floor(index / NUM_COLUMNS);
      if (row !== currentRowRef.current) {
        currentRowRef.current = row;
        const topRow = Math.max(0, row - 1);
        const scrollY = topRow * TV_ROW_H;
        listRefStable.current.scrollToOffset({ offset: scrollY, animated: false });
      }
    }
  }, []);

  // Stable extraData so FlatList only re-renders when focusTrigger changes
  const extraData = useMemo(() => ({ focusTrigger }), [focusTrigger]);

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <LibraryCard
      item={item}
      width={ITEM_WIDTH}
      posterHeight={isTV ? TV_POSTER_H : undefined}
      onPress={() => handleItemPress(item)}
      onFocus={() => handleCardFocus(item, index)}
      hasTVPreferredFocus={index === 0 && focusTrigger > 0}
    />
  ), [handleItemPress, handleCardFocus, focusTrigger]);

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
          onPress={() => setType('show')}
        >
          <Text style={[styles.toggleText, type === 'show' && styles.toggleTextActive]}>
            TV Shows
          </Text>
        </TVPressable>
        <TVPressable
          style={[styles.toggleChip, type === 'movie' && styles.toggleChipActive]}
          onPress={() => setType('movie')}
        >
          <Text style={[styles.toggleText, type === 'movie' && styles.toggleTextActive]}>
            Movies
          </Text>
        </TVPressable>
      </View>

      <View style={styles.sortRow}>
        {(Object.keys(SORT_LABELS) as SortField[]).map((field) => (
          <TVPressable
            key={field}
            style={[styles.sortChip, sortField === field && styles.sortChipActive]}
            onPress={() => {
              if (sortField === field) {
                setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
              } else {
                setSortField(field);
                setSortDir(field === 'added' || field === 'watched' ? 'desc' : 'asc');
              }
              listRef.current?.scrollToOffset({ offset: 0, animated: false });
              currentRowRef.current = 0;
            }}
          >
            <Text style={[styles.sortText, sortField === field && styles.sortTextActive]}>
              {SORT_LABELS[field]}{sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </Text>
          </TVPressable>
        ))}
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
          scrollEnabled={!isTV}
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
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  sortChip: {
    paddingHorizontal: isTV ? spacing.lg : spacing.md,
    paddingVertical: isTV ? 6 : 4,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  sortChipActive: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
  },
  sortText: {
    fontSize: isTV ? 13 : 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  sortTextActive: {
    color: colors.primary,
    fontWeight: '600',
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
