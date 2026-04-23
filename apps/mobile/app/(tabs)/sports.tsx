import React, { useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SportsEvent } from '@whatson/shared';
import { SportsShelf } from '@/components/SportsShelf';
import { api } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { useTVBackHandler } from '@/lib/useBackHandler';
import { colors, spacing, typography } from '@/constants/theme';

export default function SportsScreen() {
  const scrollRef = useRef<ScrollView>(null);
  useTVBackHandler(useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    return true;
  }, []));

  const nowQuery = useQuery({
    queryKey: ['sports', 'now'],
    queryFn: api.getSportsNow,
    // Refresh live scores every 30 s — matches the service-layer cache TTL.
    refetchInterval: 30000,
  });
  const laterQuery = useQuery({
    queryKey: ['sports', 'later'],
    queryFn: () => api.getSportsLater(24),
    refetchInterval: 5 * 60 * 1000,
  });
  const prefsQuery = useQuery({
    queryKey: ['sports', 'prefs'],
    queryFn: api.getSportsPrefs,
  });

  const handlePress = useCallback((e: SportsEvent) => {
    router.push({ pathname: '/sports-detail', params: { id: e.id } } as any);
  }, []);

  const refetchAll = useCallback(() => {
    nowQuery.refetch();
    laterQuery.refetch();
  }, [nowQuery, laterQuery]);

  const isLoading = nowQuery.isLoading || laterQuery.isLoading;
  const noPrefs = (prefsQuery.data?.leagues.length ?? 0) === 0;
  const hasNow = (nowQuery.data?.length ?? 0) > 0;
  const hasLater = (laterQuery.data?.length ?? 0) > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {!isTV && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Sports</Text>
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        refreshControl={
          isTV ? undefined : (
            <RefreshControl
              refreshing={nowQuery.isRefetching || laterQuery.isRefetching}
              onRefresh={refetchAll}
              tintColor={colors.primary}
            />
          )
        }
      >
        {isLoading && (
          <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>
        )}

        {!isLoading && noPrefs && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No teams or sports followed yet</Text>
            <Text style={styles.emptyBody}>Open Settings → Sports to pick leagues and teams.</Text>
            <Pressable style={styles.settingsButton} onPress={() => router.push('/sports-settings' as any)} focusable>
              <Text style={styles.settingsButtonText}>Go to Sports Settings</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !noPrefs && (
          <>
            {hasNow && <SportsShelf title="Sports On Now" events={nowQuery.data!} onItemPress={handlePress} />}
            {hasLater && <SportsShelf title="Sports On Later" events={laterQuery.data!} onItemPress={handlePress} />}
            {!hasNow && !hasLater && (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nothing on right now</Text>
                <Text style={styles.emptyBody}>No games are live or starting in the next 24 hours for your followed leagues.</Text>
              </View>
            )}
          </>
        )}

        <View style={{ height: isTV ? 100 : 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { ...typography.title },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  empty: { paddingHorizontal: spacing.lg, paddingVertical: 60, alignItems: 'center' },
  emptyTitle: { ...typography.sectionTitle, marginBottom: spacing.sm, textAlign: 'center' },
  emptyBody: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg },
  settingsButton: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 8 },
  settingsButtonText: { color: '#000', fontWeight: '700' },
});
