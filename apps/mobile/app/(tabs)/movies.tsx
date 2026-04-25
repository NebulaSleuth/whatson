import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ContentItem, ContentSection } from '@whatson/shared';
import { ShelfList, type ShelfListHandle } from '@/components/ShelfList';
import { DetailSheet } from '@/components/DetailSheet';
import { SkeletonShelf } from '@/components/SkeletonCard';
import { ErrorState } from '@/components/ErrorState';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { isTV } from '@/lib/tv';
import { useTabNodeId } from './_layout';
import { useTVBackHandler } from '@/lib/useBackHandler';
import { colors, spacing, typography } from '@/constants/theme';

export default function MoviesScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const shelfListRef = useRef<ShelfListHandle>(null);
  const tabNodeId = useTabNodeId();
  useTVBackHandler(useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    shelfListRef.current?.focusFirst();
    return true;
  }, []));

  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const isReady = useAppStore((s) => s.isReady);

  const {
    data: recent,
    isLoading: loadingRecent,
    error: errorRecent,
    refetch: refetchRecent,
    isRefetching: isRefetchingRecent,
  } = useQuery({
    queryKey: ['movies', 'recent'],
    queryFn: api.getMoviesRecent,
    enabled: isReady,
  });

  const {
    data: upcoming,
    isLoading: loadingUpcoming,
    refetch: refetchUpcoming,
    isRefetching: isRefetchingUpcoming,
  } = useQuery({
    queryKey: ['movies', 'upcoming'],
    queryFn: () => api.getMoviesUpcoming(30),
  });

  const {
    data: downloading,
    refetch: refetchDownloading,
  } = useQuery({
    queryKey: ['movies', 'downloading'],
    queryFn: api.getMoviesDownloading,
  });

  const isLoading = loadingRecent || loadingUpcoming;
  const error = errorRecent;

  const refetchAll = useCallback(() => {
    refetchRecent();
    refetchUpcoming();
    refetchDownloading();
  }, [refetchRecent, refetchUpcoming, refetchDownloading]);

  const handleItemPress = useCallback((item: ContentItem) => {
    setSelectedItem(item);
  }, []);

  const recentItems = useMemo(() => recent?.filter((i) => !i.progress.watched) || [], [recent]);
  const comingSoonItems = useMemo(() => upcoming || [], [upcoming]);
  const downloadingItems = useMemo(() => downloading || [], [downloading]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {!isTV && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Movies</Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        refreshControl={
          isTV ? undefined : <RefreshControl
            refreshing={isRefetchingRecent || isRefetchingUpcoming}
            onRefresh={refetchAll}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading && (
          <>
            <SkeletonShelf />
            <SkeletonShelf />
          </>
        )}

        {error && !isLoading && (
          <ErrorState message={(error as Error).message} onRetry={refetchAll} />
        )}

        {!isLoading && !error && (
          <>
            {(() => {
              const sections: ContentSection[] = [];
              if (downloadingItems.length > 0) sections.push({ id: 'movies-downloading', title: 'Downloading', type: 'movie', items: downloadingItems, sortOrder: 0 });
              if (recentItems.length > 0) sections.push({ id: 'movies-recent', title: 'Ready to Watch', type: 'movie', items: recentItems, sortOrder: 1 });
              if (comingSoonItems.length > 0) sections.push({ id: 'movies-coming', title: 'Coming Soon', type: 'movie', items: comingSoonItems, sortOrder: 2 });
              if (sections.length === 0) return null;
              return (
                <ShelfList
                  ref={shelfListRef}
                  sections={sections}
                  onItemPress={handleItemPress}
                  onRefresh={refetchAll}
                  tabBarNodeId={tabNodeId}
                />
              );
            })()}

            {recentItems.length === 0 && comingSoonItems.length === 0 && downloadingItems.length === 0 && (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No movies to display</Text>
              </View>
            )}
          </>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {selectedItem && (
        <DetailSheet
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onRefresh={refetchAll}
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  headerTitle: {
    ...typography.title,
  },
  scrollView: {
    flex: 1,
  },
  emptyContainer: {
    paddingTop: 100,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
  },
  bottomSpacer: {
    height: 40,
  },
});
