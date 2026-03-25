import React, { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ContentItem, ContentSection, TrackedItem } from '@whatson/shared';
import { STREAMING_PROVIDERS } from '@whatson/shared';
import { ShelfList } from '@/components/ShelfList';
import { DetailSheet } from '@/components/DetailSheet';
import { SkeletonShelf } from '@/components/SkeletonCard';
import { ErrorState } from '@/components/ErrorState';
import { api } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { useTVBackHandler } from '@/lib/useBackHandler';
import { colors, spacing, typography } from '@/constants/theme';

function trackedShowToContentItem(t: TrackedItem): ContentItem {
  const providerLabel = (STREAMING_PROVIDERS as any)[t.provider] || t.provider;
  return {
    id: t.id,
    type: 'show',
    title: t.title,
    summary: t.overview,
    duration: 0,
    artwork: {
      poster: t.poster,
      thumbnail: t.backdrop || t.poster,
      background: t.backdrop || t.poster,
    },
    source: 'live',
    sourceId: String(t.tmdbId),
    status: 'ready',
    progress: { watched: false, percentage: 0, currentPosition: 0 },
    availability: { availableAt: t.addedAt, network: providerLabel },
    addedAt: t.addedAt,
    year: t.year,
    rating: t.rating,
    genres: [],
  };
}

export default function TVShowsScreen() {
  const scrollRef = useRef<ScrollView>(null);
  useTVBackHandler(useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    return true;
  }, []));

  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);

  const {
    data: recent,
    isLoading: loadingRecent,
    error: errorRecent,
    refetch: refetchRecent,
    isRefetching: isRefetchingRecent,
  } = useQuery({
    queryKey: ['tv', 'recent'],
    queryFn: api.getTvRecent,
  });

  const {
    data: upcoming,
    isLoading: loadingUpcoming,
    refetch: refetchUpcoming,
    isRefetching: isRefetchingUpcoming,
  } = useQuery({
    queryKey: ['tv', 'upcoming'],
    queryFn: () => api.getTvUpcoming(7),
  });

  const {
    data: downloading,
    refetch: refetchDownloading,
  } = useQuery({
    queryKey: ['tv', 'downloading'],
    queryFn: api.getTvDownloading,
  });

  const {
    data: trackedTv,
    refetch: refetchTracked,
  } = useQuery({
    queryKey: ['tracked', 'tv', 'all'],
    queryFn: api.getAllTrackedTv,
  });

  const isLoading = loadingRecent || loadingUpcoming;
  const error = errorRecent;

  const refetchAll = useCallback(() => {
    refetchRecent();
    refetchUpcoming();
    refetchDownloading();
    refetchTracked();
  }, [refetchRecent, refetchUpcoming, refetchDownloading, refetchTracked]);

  const handleItemPress = useCallback((item: ContentItem) => {
    setSelectedItem(item);
  }, []);

  const handleTrackedPress = useCallback((item: ContentItem) => {
    // Open the detail sheet — it will show tracked-specific actions
    setSelectedItem(item);
  }, []);

  const readyItems = recent?.filter((i) => !i.progress.watched) || [];
  const comingSoonItems = upcoming || [];
  const downloadingItems = downloading || [];

  // All tracked TV shows, sorted alphabetically
  const trackedItems: ContentItem[] = (trackedTv || [])
    .sort((a: TrackedItem, b: TrackedItem) => a.title.localeCompare(b.title))
    .map(trackedShowToContentItem);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>TV Shows</Text>
      </View>

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
              if (downloadingItems.length > 0) sections.push({ id: 'tv-downloading', title: 'Downloading', type: 'tv', items: downloadingItems, sortOrder: 0 });
              if (readyItems.length > 0) sections.push({ id: 'tv-ready', title: 'Ready to Watch', type: 'tv', items: readyItems, sortOrder: 1 });
              if (comingSoonItems.length > 0) sections.push({ id: 'tv-coming', title: 'Coming Soon', type: 'tv', items: comingSoonItems, sortOrder: 2 });
              if (trackedItems.length > 0) sections.push({ id: 'tv-tracked', title: 'Tracked', type: 'tv', items: trackedItems, sortOrder: 3 });
              if (sections.length === 0) return null;
              return (
                <ShelfList
                  sections={sections}
                  onItemPress={(item) => {
                    // Tracked items use a different handler
                    if (item.id.startsWith('tracked-') && item.type === 'show') {
                      handleTrackedPress(item);
                    } else {
                      handleItemPress(item);
                    }
                  }}
                  onRefresh={refetchAll}
                />
              );
            })()}

            {readyItems.length === 0 && comingSoonItems.length === 0 &&
             downloadingItems.length === 0 && trackedItems.length === 0 && (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No TV shows to display</Text>
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
