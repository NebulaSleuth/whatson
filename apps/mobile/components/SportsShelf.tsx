import React, { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { Image } from 'expo-image';
import type { SportsCompetitor, SportsEvent } from '@whatson/shared';
import { colors, spacing, typography } from '@/constants/theme';
import { isTV } from '@/lib/tv';

const CARD_WIDTH = isTV ? 340 : 280;
const CARD_HEIGHT = isTV ? 160 : 140;

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Sports card with three zones: header (league + LIVE pill), body (stacked
 * team rows with large right-aligned score for in-progress events, or a
 * tournament title for non-team sports), and footer (status + broadcast).
 */
export const SportsCard = React.memo(function SportsCard({
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
      style={[styles.card, focused && styles.cardFocused, live && styles.cardLive]}
      onPress={() => onPress(event)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      focusable
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.league} numberOfLines={1}>{event.leagueLabel}</Text>
        {live && (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        )}
      </View>

      {/* Body */}
      <View style={styles.body}>
        {event.teamSport && event.competitors.length >= 2 ? (
          <>
            <TeamRow c={event.competitors[0]} highlightScore={live} />
            <TeamRow c={event.competitors[1]} highlightScore={live} />
          </>
        ) : (
          <Text style={styles.tournamentTitle} numberOfLines={2}>{event.title}</Text>
        )}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.status} numberOfLines={1}>
          {live
            ? event.statusDetail
            : event.status === 'post'
              ? event.statusDetail
              : (formatLocalTime(event.startsAt) || event.statusDetail)}
        </Text>
        {event.broadcast ? (
          <View style={styles.broadcastPill}>
            <Text style={styles.broadcastText} numberOfLines={1}>{event.broadcast}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

function TeamRow({ c, highlightScore }: { c: SportsCompetitor; highlightScore: boolean }) {
  const name = c.abbreviation || c.shortName || c.name;
  return (
    <View style={styles.teamRow}>
      {c.logo ? (
        <Image source={{ uri: c.logo }} style={styles.teamLogo} contentFit="contain" cachePolicy="disk" />
      ) : (
        <View style={[styles.teamLogo, styles.teamLogoPlaceholder]} />
      )}
      <Text style={styles.teamName} numberOfLines={1}>{name}</Text>
      {c.score != null ? (
        <Text style={[styles.teamScore, highlightScore && styles.teamScoreLive, c.winner && styles.teamScoreWinner]}>
          {c.score}
        </Text>
      ) : null}
    </View>
  );
}

export function SportsShelf({
  title,
  events,
  onItemPress,
}: {
  title: string;
  events: SportsEvent[];
  onItemPress: (e: SportsEvent) => void;
}) {
  const renderItem = useCallback(
    ({ item }: { item: SportsEvent }) => <SportsCard event={item} onPress={onItemPress} />,
    [onItemPress],
  );
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

const styles = StyleSheet.create({
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
  cardLive: { borderColor: 'rgba(229, 57, 53, 0.25)' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  league: { ...typography.caption, color: colors.textMuted, flex: 1 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e53935',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },

  body: { flex: 1, justifyContent: 'center', gap: 4 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  teamLogo: { width: 22, height: 22 },
  teamLogoPlaceholder: { backgroundColor: '#222', borderRadius: 11 },
  teamName: { ...typography.body, color: colors.text, fontWeight: '600', flex: 1 },
  teamScore: {
    fontSize: isTV ? 22 : 20,
    fontWeight: '800',
    color: colors.text,
    minWidth: 30,
    textAlign: 'right',
  },
  teamScoreLive: { color: '#fff' },
  teamScoreWinner: { color: colors.primary },
  tournamentTitle: { ...typography.body, color: colors.text, fontWeight: '600' },

  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  status: { ...typography.caption, color: colors.text, flex: 1 },
  broadcastPill: {
    backgroundColor: 'rgba(229, 160, 13, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    maxWidth: 120,
  },
  broadcastText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});
