import React, { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ContentItem } from '@whatson/shared';
import { ShelfList, type ShelfListHandle } from '@/components/ShelfList';
import { DetailSheet } from '@/components/DetailSheet';
import { SkeletonShelf } from '@/components/SkeletonCard';
import { isTV } from '@/lib/tv';
import { useTVBackHandler } from '@/lib/useBackHandler';
import { ErrorState } from '@/components/ErrorState';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { colors, spacing, typography } from '@/constants/theme';

export default function HomeScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const shelfListRef = useRef<ShelfListHandle>(null);

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

  const handleItemPress = useCallback((item: ContentItem) => {
    setSelectedItem(item);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedItem(null);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Whats On</Text>
        {!isTV && <Text style={styles.headerSubtitle}>Tonight</Text>}
      </View>

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
        {isLoading && (
          <>
            <SkeletonShelf />
            <SkeletonShelf />
            <SkeletonShelf />
          </>
        )}

        {error && !isLoading && (
          <ErrorState
            message={(error as Error).message}
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !error && data?.sections && (
          <ShelfList
            ref={shelfListRef}
            sections={data.sections}
            onItemPress={handleItemPress}
            onRefresh={() => refetch()}
          />
        )}

        {!isLoading && !error && (!data?.sections || data.sections.length === 0) && (
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
