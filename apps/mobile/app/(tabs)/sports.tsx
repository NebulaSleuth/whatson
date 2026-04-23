import React, { useCallback, useRef } from 'react';
import { View, Text, ScrollView, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SportsEvent } from '@whatson/shared';
import { api } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { useTVBackHandler } from '@/lib/useBackHandler';
import { colors, spacing, typography } from '@/constants/theme';

const CARD_WIDTH = isTV ? 340 : 280;
const CARD_HEIGHT = isTV ? 150 : 130;

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const SportsCard = React.memo(function SportsCard({
  event,
  onPress,
}: {
  event: SportsEvent;
  onPress: (event: SportsEvent) => void;
}) {
  const [focused, setFocused] = React.useState(false);
  const live = event.status === 'in';

  return (
    <Pressable
      style={[cardStyles.card, focused && cardStyles.cardFocused]}
      onPress={() => onPress(event)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      focusable
    >
      <View style={cardStyles.header}>
        <Text style={cardStyles.league} numberOfLines={1}>{event.leagueLabel}</Text>
        {live && <View style={cardStyles.liveBadge}><Text style={cardStyles.liveText}>LIVE</Text></View>}
      </View>

      {event.teamSport && event.competitors.length >= 2 ? (
        <View style={cardStyles.teamsRow}>
          <TeamSide c={event.competitors[0]} />
          <Text style={cardStyles.vs}>vs</Text>
          <TeamSide c={event.competitors[1]} />
        </View>
      ) : (
        <Text style={cardStyles.tournamentTitle} numberOfLines={2}>{event.title}</Text>
      )}

      <View style={cardStyles.footer}>
        <Text style={cardStyles.status} numberOfLines={1}>
          {live ? event.statusDetail : event.status === 'post' ? event.statusDetail : formatLocalTime(event.startsAt) || event.statusDetail}
        </Text>
        {event.broadcast && (
          <Text style={cardStyles.broadcast} numberOfLines={1}>{event.broadcast}</Text>
        )}
      </View>
    </Pressable>
  );
});

function TeamSide({ c }: { c: SportsEvent['competitors'][number] }) {
  return (
    <View style={cardStyles.teamSide}>
      {c.logo ? (
        <Image source={{ uri: c.logo }} style={cardStyles.teamLogo} contentFit="contain" cachePolicy="disk" />
      ) : (
        <View style={[cardStyles.teamLogo, cardStyles.teamLogoPlaceholder]} />
      )}
      <Text style={cardStyles.teamName} numberOfLines={1}>{c.abbreviation || c.shortName || c.name}</Text>
      {c.score != null && <Text style={cardStyles.teamScore}>{c.score}</Text>}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginRight: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'space-between',
  },
  cardFocused: { borderColor: colors.focus },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  league: { ...typography.caption, color: colors.textMuted, flex: 1 },
  liveBadge: { backgroundColor: '#e53935', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  liveText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  teamsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 },
  teamSide: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm },
  teamLogo: { width: 28, height: 28 },
  teamLogoPlaceholder: { backgroundColor: '#222', borderRadius: 14 },
  teamName: { ...typography.body, color: colors.text, flex: 1, fontWeight: '600' },
  teamScore: { ...typography.body, color: colors.text, fontWeight: '700', fontSize: 18 },
  vs: { ...typography.caption, color: colors.textMuted, marginHorizontal: spacing.sm },
  tournamentTitle: { ...typography.body, color: colors.text, fontWeight: '600', flex: 1 },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
  status: { ...typography.caption, color: colors.text, flex: 1 },
  broadcast: { ...typography.caption, color: colors.textMuted, marginLeft: spacing.sm },
});

function SportsShelf({ title, events, onItemPress }: { title: string; events: SportsEvent[]; onItemPress: (e: SportsEvent) => void }) {
  const renderItem = useCallback(({ item }: { item: SportsEvent }) => (
    <SportsCard event={item} onPress={onItemPress} />
  ), [onItemPress]);
  return (
    <View style={shelfStyles.container}>
      <Text style={shelfStyles.title}>{title}</Text>
      <FlatList
        horizontal
        data={events}
        keyExtractor={(e) => e.id}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={shelfStyles.list}
      />
    </View>
  );
}

const shelfStyles = StyleSheet.create({
  container: { marginBottom: isTV ? spacing.md : spacing.xl },
  title: { ...typography.sectionTitle, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  list: { paddingHorizontal: spacing.lg },
});

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
