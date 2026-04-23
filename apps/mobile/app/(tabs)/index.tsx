import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ContentItem, ContentSection, SportsEvent } from '@whatson/shared';
import { ShelfList, type ShelfListHandle } from '@/components/ShelfList';
import { SportsShelf } from '@/components/SportsShelf';
import { DetailSheet } from '@/components/DetailSheet';
import { SkeletonShelf } from '@/components/SkeletonCard';
import { isTV } from '@/lib/tv';
import { useTVBackHandler } from '@/lib/useBackHandler';
import { useTabNodeId } from './_layout';
import { ErrorState } from '@/components/ErrorState';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { colors, spacing, typography } from '@/constants/theme';

export default function HomeScreen() {
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
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['home'],
    queryFn: () => api.getHome(),
    enabled: isReady,
  });

  const showByw = useAppStore((s) => s.showBecauseYouWatched);
  const { data: recData } = useQuery({
    queryKey: ['recommendations', showByw],
    queryFn: () => api.getRecommendations(showByw),
    enabled: isReady && !isLoading,
    staleTime: 10 * 60 * 1000, // Fresh for 10 minutes
  });

  // Sports shelves — only mount queries when the user has followed at least
  // one league. Keeps anonymous home loads free of extra ESPN traffic.
  const { data: sportsPrefs } = useQuery({
    queryKey: ['sports', 'prefs'],
    queryFn: api.getSportsPrefs,
    enabled: isReady,
    staleTime: 60 * 1000,
  });
  const followsSports = (sportsPrefs?.leagues.length ?? 0) > 0;
  const { data: sportsNow } = useQuery({
    queryKey: ['sports', 'now'],
    queryFn: api.getSportsNow,
    enabled: isReady && followsSports,
    refetchInterval: followsSports ? 30000 : false,
  });
  const { data: sportsLater } = useQuery({
    queryKey: ['sports', 'later'],
    queryFn: () => api.getSportsLater(24),
    enabled: isReady && followsSports,
    refetchInterval: followsSports ? 5 * 60 * 1000 : false,
  });
  const handleSportsPress = useCallback((e: SportsEvent) => {
    router.push({ pathname: '/sports-detail', params: { id: e.id } } as any);
  }, []);

  const liveChannels = useAppStore((s) => s.liveTvChannels);
  const channelsKey = liveChannels.join(',');
  const { data: liveNow } = useQuery({
    queryKey: ['live', 'now', channelsKey],
    queryFn: () => api.getLiveNow(liveChannels),
    enabled: isReady && liveChannels.length > 0,
    staleTime: 60 * 1000,
  });
  const { data: liveLater } = useQuery({
    queryKey: ['live', 'later', channelsKey],
    queryFn: () => api.getLiveLater(liveChannels, 6),
    enabled: isReady && liveChannels.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const liveSections = useMemo<ContentSection[]>(() => {
    const out: ContentSection[] = [];
    if (liveNow && liveNow.length > 0) {
      out.push({ id: 'live-now', title: "What's on TV", type: 'mixed', items: liveNow, sortOrder: 0 });
    }
    if (liveLater && liveLater.length > 0) {
      out.push({ id: 'live-later', title: "What's on TV Later", type: 'mixed', items: liveLater, sortOrder: 1 });
    }
    return out;
  }, [liveNow, liveLater]);

  // On TV, focus the first shelf card when data loads
  const hasFocusedInitial = useRef(false);
  useEffect(() => {
    if (isTV && data?.sections?.length && !hasFocusedInitial.current) {
      hasFocusedInitial.current = true;
      // Short delay to let ShelfList render and register card refs
      setTimeout(() => shelfListRef.current?.focusFirst(), 100);
    }
  }, [data]);

  const handleItemPress = useCallback((item: ContentItem) => {
    setSelectedItem(item);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedItem(null);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {!isTV && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Whats On</Text>
          <Text style={styles.headerSubtitle}>Tonight</Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        refreshControl={
          isTV ? undefined : (
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => refetch()}
              tintColor={colors.primary}
            />
          )
        }
      >
        {(!isReady || isLoading) && (
          <>
            <SkeletonShelf />
            <SkeletonShelf />
            <SkeletonShelf />
          </>
        )}

        {isReady && error && !isLoading && (
          <ErrorState
            message={(error as Error).message}
            onRetry={() => refetch()}
          />
        )}

        {isReady && !isLoading && !error && data?.sections && (
          <ShelfList
            ref={shelfListRef}
            sections={data.sections}
            onItemPress={handleItemPress}
            onRefresh={() => refetch()}
            tabBarNodeId={tabNodeId}
          />
        )}

        {isReady && !isLoading && !error && followsSports && (sportsNow?.length ?? 0) > 0 && (
          <SportsShelf title="Sports On Now" events={sportsNow!} onItemPress={handleSportsPress} />
        )}

        {isReady && !isLoading && !error && followsSports && (sportsLater?.length ?? 0) > 0 && (
          <SportsShelf title="Sports On Later" events={sportsLater!} onItemPress={handleSportsPress} />
        )}

        {isReady && !isLoading && !error && liveSections.length > 0 && (
          <ShelfList
            sections={liveSections}
            onItemPress={handleItemPress}
          />
        )}

        {/* Recommendation shelves — below main content */}
        {isReady && !isLoading && !error && recData?.sections && recData.sections.length > 0 && (
          <ShelfList
            sections={recData.sections}
            onItemPress={handleItemPress}
          />
        )}

        {isReady && !isLoading && !error && (!data?.sections || data.sections.length === 0) && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Nothing to show</Text>
            <Text style={styles.emptyText}>
              Connect your Plex, Sonarr, and Radarr servers to get started.
            </Text>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {selectedItem && (
        <DetailSheet
          item={selectedItem}
          onClose={handleCloseDetail}
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
    paddingHorizontal: spacing.lg,
    paddingTop: isTV ? spacing.sm : spacing.md,
    paddingBottom: isTV ? spacing.sm : spacing.lg,
  },
  headerTitle: {
    fontSize: isTV ? 24 : 28,
    fontWeight: '800',
    color: colors.primary,
  },
  headerSubtitle: {
    ...typography.body,
    marginTop: 2,
    ...(isTV ? { display: 'none' as any } : {}),
  },
  scrollView: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    ...typography.title,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
  },
  bottomSpacer: {
    height: 40,
  },
});
