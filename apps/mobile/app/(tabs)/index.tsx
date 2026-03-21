import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ContentItem } from '@whatson/shared';
import { ShelfList } from '@/components/ShelfList';
import { DetailSheet } from '@/components/DetailSheet';
import { SkeletonShelf } from '@/components/SkeletonCard';
import { isTV } from '@/lib/tv';
import { ErrorState } from '@/components/ErrorState';
import { api } from '@/lib/api';
import { colors, spacing, typography } from '@/constants/theme';

function RefreshButton({ isRefetching, onRefresh }: { isRefetching: boolean; onRefresh: () => void }) {
  const [focused, setFocused] = React.useState(false);

  return (
    <View style={styles.refreshRow}>
      {isRefetching ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Pressable
          onPress={onRefresh}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          focusable={true}
          style={[
            styles.refreshButton,
            isTV && focused && styles.refreshButtonFocused,
          ]}
        >
          <Text style={[
            styles.refreshText,
            isTV && focused && styles.refreshTextFocused,
          ]}>
            Refresh
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['home'],
    queryFn: () => api.getHome(),
  });

  const handleRefresh = useCallback(async () => {
    // Force backend cache bust, then refetch
    await api.getHome(true); // bust backend cache
    refetch(); // refetch with React Query (triggers isRefetching)
  }, [refetch]);

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
        style={styles.scrollView}
        refreshControl={
          isTV ? undefined : (
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
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

        {!isLoading && !error && (
          <RefreshButton isRefetching={isRefetching} onRefresh={handleRefresh} />
        )}

        {!isLoading && !error && data?.sections && (
          <ShelfList
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
  refreshRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  refreshButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.cardBorder,
  },
  refreshButtonFocused: {
    borderColor: colors.focus,
    backgroundColor: colors.surfaceHover,
  },
  refreshText: {
    fontSize: isTV ? 16 : 13,
    fontWeight: '600',
    color: colors.primary,
  },
  refreshTextFocused: {
    color: colors.focus,
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
