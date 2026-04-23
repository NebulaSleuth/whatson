import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SportsCompetitor, SportsEvent } from '@whatson/shared';
import { api } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { colors, spacing, typography } from '@/constants/theme';

export default function SportsDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = params.id || '';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sports', 'event', id],
    queryFn: () => api.getSportsEvent(id),
    // Poll every 15 s while the event is live; stop once final or scheduled-only.
    refetchInterval: (q) => (q.state.data?.status === 'in' ? 15000 : false),
    enabled: Boolean(id),
  });

  const onBack = useCallback(() => router.back(), []);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}><View style={styles.centerFill}><ActivityIndicator size="large" color={colors.primary} /></View></SafeAreaView>
    );
  }
  if (error || !data) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerFill}>
          <Text style={styles.errorText}>{error ? (error as Error).message : 'Event not found'}</Text>
          <Pressable style={styles.button} onPress={onBack} focusable><Text style={styles.buttonText}>Back</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable style={styles.backButton} onPress={onBack} focusable>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>

        <Text style={styles.league}>{data.leagueLabel}</Text>
        <Text style={styles.title}>{data.title}</Text>

        <View style={[styles.statusRow, data.status === 'in' && styles.statusRowLive]}>
          {data.status === 'in' && <View style={styles.liveBadge}><Text style={styles.liveText}>LIVE</Text></View>}
          <Text style={styles.statusText}>{data.statusDetail}</Text>
          {data.broadcast && <Text style={styles.broadcast}>on {data.broadcast}</Text>}
        </View>

        {data.teamSport && data.competitors.length >= 2 ? (
          <View style={styles.matchup}>
            <TeamBlock c={data.competitors[0]} />
            <Text style={styles.atSymbol}>@</Text>
            <TeamBlock c={data.competitors[1]} />
          </View>
        ) : (
          <View style={styles.tournamentBlock}>
            <Text style={styles.tournamentSubtitle}>{data.subtitle || data.leagueLabel}</Text>
            {data.venue && <Text style={styles.venue}>{data.venue}</Text>}
          </View>
        )}

        <View style={styles.metaBlock}>
          {data.venue && data.teamSport && <MetaRow label="Venue" value={data.venue} />}
          <MetaRow label="Starts" value={new Date(data.startsAt).toLocaleString()} />
          {data.status === 'in' && <MetaRow label="Live updates" value="Every 15s" />}
        </View>

        <Pressable style={styles.button} onPress={() => refetch()} focusable>
          <Text style={styles.buttonText}>Refresh now</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function TeamBlock({ c }: { c: SportsCompetitor }) {
  return (
    <View style={styles.team}>
      {c.logo ? (
        <Image source={{ uri: c.logo }} style={styles.teamLogoBig} contentFit="contain" cachePolicy="disk" />
      ) : (
        <View style={[styles.teamLogoBig, styles.teamLogoPlaceholder]} />
      )}
      <Text style={styles.teamNameBig} numberOfLines={2}>{c.name}</Text>
      {c.record && <Text style={styles.record}>{c.record}</Text>}
      <Text style={[styles.scoreBig, c.winner && styles.scoreWinner]}>{c.score ?? '–'}</Text>
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  backButton: { paddingVertical: spacing.sm, marginBottom: spacing.md },
  backText: { ...typography.body, color: colors.primary },
  league: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  title: { ...typography.title, marginBottom: spacing.lg },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xl },
  statusRowLive: {},
  liveBadge: { backgroundColor: '#e53935', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginRight: spacing.sm },
  liveText: { color: '#fff', fontWeight: '700', fontSize: 11, letterSpacing: 0.5 },
  statusText: { ...typography.body, color: colors.text, fontWeight: '600' },
  broadcast: { ...typography.caption, color: colors.textMuted, marginLeft: spacing.sm },
  matchup: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: spacing.xl, marginBottom: spacing.xl },
  team: { alignItems: 'center', flex: 1, gap: spacing.xs },
  teamLogoBig: { width: isTV ? 110 : 80, height: isTV ? 110 : 80, marginBottom: spacing.sm },
  teamLogoPlaceholder: { backgroundColor: '#222', borderRadius: 8 },
  teamNameBig: { ...typography.sectionTitle, textAlign: 'center', fontSize: isTV ? 20 : 16 },
  record: { ...typography.caption, color: colors.textMuted },
  scoreBig: { fontSize: isTV ? 56 : 42, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  scoreWinner: { color: colors.primary },
  atSymbol: { ...typography.sectionTitle, color: colors.textMuted, fontSize: 28 },
  tournamentBlock: { paddingVertical: spacing.xl, marginBottom: spacing.xl, alignItems: 'center' },
  tournamentSubtitle: { ...typography.sectionTitle, textAlign: 'center' },
  venue: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  metaBlock: { backgroundColor: colors.surface, borderRadius: 8, padding: spacing.md, marginBottom: spacing.xl },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  metaLabel: { ...typography.caption, color: colors.textMuted },
  metaValue: { ...typography.caption, color: colors.text },
  button: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 8, alignSelf: 'center' },
  buttonText: { color: '#000', fontWeight: '700' },
  errorText: { ...typography.body, color: colors.text, marginBottom: spacing.lg },
});
