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

const LibraryGridCard = React.memo(function LibraryGridCard({
  item, width, onPress,
}: {
  item: ContentItem; width: number; onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const posterWidth = width - spacing.sm * 2;
  const posterHeight = posterWidth * 1.5; // 2:3 ratio

  return (
    <Pressable
      style={[gridCardStyles.container, { width }]}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      focusable={true}
    >
      <View style={[
        gridCardStyles.posterContainer,
        { width: posterWidth, height: posterHeight },
        isTV && focused && gridCardStyles.posterFocused,
      ]}>
        <Image
          source={{ uri: resolveArtworkUrl(item.artwork.poster) }}
          style={gridCardStyles.poster}
          contentFit="cover"
          cachePolicy="disk"
          transition={isTV ? 0 : 200}
        />
      </View>
      <Text style={[gridCardStyles.title, isTV && focused && gridCardStyles.titleFocused]} numberOfLines={1}>
        {item.showTitle || item.title}
      </Text>
    </Pressable>
  );
});

const gridCardStyles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.xs,
    paddingVertical: isTV ? spacing.sm : 0,
    marginBottom: isTV ? spacing.md : spacing.md,
  },
  posterContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 2,
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

export default function LibraryScreen() {
  const [type, setType] = useState<LibraryType>('show');
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['library', type],
    queryFn: () => api.getLibrary(type),
  });

  const handleItemPress = useCallback((item: ContentItem) => {
    setSelectedItem(item);
  }, []);

  const items = data || [];
  const numColumns = isTV ? 7 : 3;
  const screenWidth = Dimensions.get('window').width;
  const gridPadding = spacing.md * 2;
  const itemWidth = Math.floor((screenWidth - gridPadding) / numColumns);

  // Scroll to keep focused card fully visible
  // No manual scroll — let Android TV's native focus-scroll handle it

  const renderItem = useCallback(({ item }: { item: ContentItem }) => (
    <LibraryGridCard
      item={item}
      width={itemWidth}
      onPress={() => handleItemPress(item)}
    />
  ), [handleItemPress, itemWidth]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
        <Text style={styles.headerCount}>
          {items.length > 0 ? `${items.length} titles` : ''}
        </Text>
      </View>

      {/* Type Toggle */}
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

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : (
        <FlatList
          key={`library-${type}-${numColumns}`}
          data={items}
          numColumns={numColumns}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.grid}
          removeClippedSubviews={false}
          maxToRenderPerBatch={isTV ? 35 : 12}
          windowSize={isTV ? 11 : 5}
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
    paddingBottom: isTV ? 200 : 40,
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
