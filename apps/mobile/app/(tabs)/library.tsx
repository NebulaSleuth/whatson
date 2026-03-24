import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, Dimensions, ScrollView } from 'react-native';
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

// TV event handler
let useTVEventHandler: any = null;
if (isTV) {
  try { useTVEventHandler = require('react-native').useTVEventHandler; } catch {}
}

type LibraryType = 'show' | 'movie';

const NUM_COLUMNS = isTV ? 7 : 3;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const GRID_PADDING = spacing.md * 2;
const ITEM_WIDTH = Math.floor((SCREEN_WIDTH - GRID_PADDING) / NUM_COLUMNS);
const CARD_PADDING = spacing.xs * 2;
const POSTER_WIDTH = ITEM_WIDTH - CARD_PADDING;
const POSTER_HEIGHT = Math.floor(POSTER_WIDTH * 1.5);
const TITLE_HEIGHT = 24;
const ROW_HEIGHT = POSTER_HEIGHT + TITLE_HEIGHT + spacing.md;

export default function LibraryScreen() {
  const [type, setType] = useState<LibraryType>('show');
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [focusInGrid, setFocusInGrid] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const focusedIndexRef = useRef(0);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['library', type],
    queryFn: () => api.getLibrary(type),
  });

  const items = data || [];
  const totalRows = Math.ceil(items.length / NUM_COLUMNS);

  // Keep ref in sync
  useEffect(() => { focusedIndexRef.current = focusedIndex; }, [focusedIndex]);

  // Scroll to keep focused row visible
  const scrollToRow = useCallback((row: number) => {
    if (!scrollRef.current) return;
    // Calculate scroll position to center the row
    const rowTop = row * ROW_HEIGHT;
    const viewportCenter = SCREEN_HEIGHT * 0.4;
    const scrollY = Math.max(0, rowTop - viewportCenter);
    scrollRef.current.scrollTo({ y: scrollY, animated: true });
  }, []);

  // Handle D-pad navigation manually on TV
  if (isTV && useTVEventHandler) {
    useTVEventHandler((evt: any) => {
      if (!focusInGrid || items.length === 0) return;

      const idx = focusedIndexRef.current;
      const row = Math.floor(idx / NUM_COLUMNS);
      const col = idx % NUM_COLUMNS;
      let newIdx = idx;

      if (evt.eventType === 'right') {
        if (col < NUM_COLUMNS - 1 && idx + 1 < items.length) newIdx = idx + 1;
      } else if (evt.eventType === 'left') {
        if (col > 0) newIdx = idx - 1;
      } else if (evt.eventType === 'down') {
        const below = idx + NUM_COLUMNS;
        if (below < items.length) newIdx = below;
      } else if (evt.eventType === 'up') {
        const above = idx - NUM_COLUMNS;
        if (above >= 0) newIdx = above;
        else {
          // Exit grid — let default focus handle tab bar
          setFocusInGrid(false);
          return;
        }
      } else if (evt.eventType === 'select') {
        if (items[idx]) setSelectedItem(items[idx]);
        return;
      } else {
        return;
      }

      if (newIdx !== idx) {
        setFocusedIndex(newIdx);
        scrollToRow(Math.floor(newIdx / NUM_COLUMNS));
      }
    });
  }

  const handleTypeChange = useCallback((newType: LibraryType) => {
    setType(newType);
    setFocusedIndex(0);
    setFocusInGrid(false);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

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
          onPress={() => handleTypeChange('show')}
        >
          <Text style={[styles.toggleText, type === 'show' && styles.toggleTextActive]}>
            TV Shows
          </Text>
        </TVPressable>
        <TVPressable
          style={[styles.toggleChip, type === 'movie' && styles.toggleChipActive]}
          onPress={() => handleTypeChange('movie')}
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
      ) : isTV ? (
        // TV: Manual grid with ScrollView — we control focus entirely
        <ScrollView ref={scrollRef} style={styles.scrollView}>
          <Pressable
            style={styles.gridContainer}
            onFocus={() => setFocusInGrid(true)}
            focusable={true}
            android_ripple={null}
          >
            {Array.from({ length: totalRows }, (_, rowIdx) => (
              <View key={rowIdx} style={styles.row}>
                {Array.from({ length: NUM_COLUMNS }, (_, colIdx) => {
                  const idx = rowIdx * NUM_COLUMNS + colIdx;
                  const item = items[idx];
                  if (!item) return <View key={colIdx} style={{ width: ITEM_WIDTH }} />;

                  const isFocused = focusInGrid && focusedIndex === idx;
                  return (
                    <Pressable
                      key={item.id}
                      style={[gridStyles.card, { width: ITEM_WIDTH }]}
                      onPress={() => setSelectedItem(item)}
                      onFocus={() => { setFocusInGrid(true); setFocusedIndex(idx); }}
                      focusable={false}
                    >
                      <View style={[
                        gridStyles.posterContainer,
                        { width: POSTER_WIDTH, height: POSTER_HEIGHT },
                        isFocused && gridStyles.posterFocused,
                      ]}>
                        <Image
                          source={{ uri: resolveArtworkUrl(item.artwork.poster) }}
                          style={gridStyles.poster}
                          contentFit="cover"
                          cachePolicy="disk"
                          transition={0}
                        />
                      </View>
                      <Text
                        style={[gridStyles.title, isFocused && gridStyles.titleFocused]}
                        numberOfLines={1}
                      >
                        {item.showTitle || item.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </Pressable>
          <View style={{ height: 100 }} />
        </ScrollView>
      ) : (
        // Phone: Standard FlatList
        <FlatList
          key={`library-${type}-${NUM_COLUMNS}`}
          data={items}
          numColumns={NUM_COLUMNS}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              style={[gridStyles.card, { width: ITEM_WIDTH }]}
              onPress={() => setSelectedItem(item)}
            >
              <View style={[gridStyles.posterContainer, { width: POSTER_WIDTH, height: POSTER_HEIGHT }]}>
                <Image
                  source={{ uri: resolveArtworkUrl(item.artwork.poster) }}
                  style={gridStyles.poster}
                  contentFit="cover"
                  cachePolicy="disk"
                />
              </View>
              <Text style={gridStyles.title} numberOfLines={1}>
                {item.showTitle || item.title}
              </Text>
            </Pressable>
          )}
          contentContainerStyle={styles.grid}
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

const gridStyles = StyleSheet.create({
  card: {
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md,
  },
  posterContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  posterFocused: {
    borderColor: colors.focus,
  },
  poster: {
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
  scrollView: {
    flex: 1,
  },
  gridContainer: {
    flexDirection: 'column',
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
  },
  grid: {
    paddingHorizontal: spacing.md,
    paddingBottom: 40,
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
