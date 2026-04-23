import React, { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { Image } from 'expo-image';
import type { SportsCompetitor, SportsEvent } from '@whatson/shared';
import { colors, spacing, typography } from '@/constants/theme';
import { isTV } from '@/lib/tv';

const CARD_WIDTH = isTV ? 340 : 280;
const CARD_HEIGHT = isTV ? 160 : 140;

// ── Helpers ──

/**
 * Format start time for upcoming cards. Shows just the time if it's today,
 * "Tomorrow 7:00 PM" if it's tomorrow (local), or "Fri 7:00 PM" for later
 * in the week. Falls back to an empty string on unparseable input.
 */
function formatUpcomingTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const eventDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDelta = Math.round((eventDay - startOfToday) / (1000 * 60 * 60 * 24));
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dayDelta === 0) return time;
  if (dayDelta === 1) return `Tomorrow ${time}`;
  if (dayDelta > 1 && dayDelta < 7) {
    return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  }
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

/** Relative luminance check for picking legible text over a team color. */
function isDarkHex(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length !== 6) return true;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.6;
}

/** Pick the color for the live-card top accent bar (followed → home → none). */
function accentColorFor(event: SportsEvent): string {
  if (!event.teamSport) return '';
  const followed = event.competitors.find((c) => c.isFollowed && c.primaryColor);
  if (followed?.primaryColor) return `#${followed.primaryColor}`;
  const home = event.competitors.find((c) => c.homeAway === 'home' && c.primaryColor);
  if (home?.primaryColor) return `#${home.primaryColor}`;
  return '';
}

// ── Upcoming card background ──

/**
 * Colored background for upcoming cards. Uses a diagonal split when both
 * competitors are followed, a solid color when one is, and falls back to
 * the home team's color when the user follows the whole league. Renders
 * nothing when no usable color exists — caller's base surface shows through.
 */
function UpcomingBackground({ event }: { event: SportsEvent }) {
  if (!event.teamSport) return null;
  const followed = event.competitors.filter((c) => c.isFollowed && c.primaryColor);

  if (followed.length >= 2) {
    const colorA = `#${followed[0].primaryColor}`;
    const colorB = `#${followed[1].primaryColor}`;
    // Two Views: solid A across the whole card, B overlayed on the right half
    // with a skewed left edge to read as a diagonal split.
    return (
      <>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colorA }]} />
        <View
          style={{
            position: 'absolute',
            top: -CARD_HEIGHT,
            bottom: -CARD_HEIGHT,
            right: -CARD_WIDTH / 2,
            width: CARD_WIDTH,
            backgroundColor: colorB,
            transform: [{ skewX: '-25deg' }],
          }}
        />
      </>
    );
  }
  const single = followed[0]
    || event.competitors.find((c) => c.homeAway === 'home' && c.primaryColor)
    || event.competitors.find((c) => c.primaryColor);
  if (single?.primaryColor) {
    return <View style={[StyleSheet.absoluteFillObject, { backgroundColor: `#${single.primaryColor}` }]} />;
  }
  return null;
}

// ── Team rows ──

function TeamRow({ c, highlightScore, textColor }: { c: SportsCompetitor; highlightScore: boolean; textColor: string }) {
  const name = c.abbreviation || c.shortName || c.name;
  return (
    <View style={styles.teamRow}>
      {c.logo ? (
        <Image source={{ uri: c.logo }} style={styles.teamLogo} contentFit="contain" cachePolicy="disk" />
      ) : (
        <View style={[styles.teamLogo, styles.teamLogoPlaceholder]} />
      )}
      <Text style={[styles.teamName, { color: textColor }]} numberOfLines={1}>{name}</Text>
      {c.score != null ? (
        <Text style={[styles.teamScore, { color: textColor }, highlightScore && styles.teamScoreLive, c.winner && styles.teamScoreWinner]}>
          {c.score}
        </Text>
      ) : null}
    </View>
  );
}

// ── Card ──

export const SportsCard = React.memo(function SportsCard({
  event,
  onPress,
}: {
  event: SportsEvent;
  onPress: (event: SportsEvent) => void;
}) {
  const [focused, setFocused] = React.useState(false);
  const live = event.status === 'in';
  const upcoming = event.status === 'pre';

  // For upcoming cards, detect if the background will be colored so we can
  // pick a contrasting text color. Live cards use the default surface tone.
  let textColor: string = colors.text;
  if (upcoming && event.teamSport) {
    const anyFollowed = event.competitors.find((c) => c.isFollowed && c.primaryColor);
    const home = event.competitors.find((c) => c.homeAway === 'home' && c.primaryColor);
    const pick = anyFollowed || home;
    if (pick?.primaryColor) {
      textColor = isDarkHex(`#${pick.primaryColor}`) ? '#fff' : '#000';
    }
  }

  return (
    <Pressable
      // Order matters: live-accent border first, then focus border, so focus
      // always wins when both conditions are true.
      style={[styles.card, live && styles.cardLive, focused && styles.cardFocused]}
      onPress={() => onPress(event)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      focusable
    >
      {/* Background (upcoming only) */}
      {upcoming && <UpcomingBackground event={event} />}

      {/* Live top accent bar */}
      {live && accentColorFor(event) !== '' && (
        <View style={[styles.accentBar, { backgroundColor: accentColorFor(event) }]} />
      )}

      {/* Dark scrim at the bottom for footer legibility over colored bg */}
      {upcoming && event.teamSport && <View style={styles.scrim} />}

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.league, upcoming && { color: textColor, opacity: 0.85 }]} numberOfLines={1}>
          {event.leagueLabel}
        </Text>
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
            <TeamRow c={event.competitors[0]} highlightScore={live} textColor={upcoming ? textColor : colors.text} />
            <TeamRow c={event.competitors[1]} highlightScore={live} textColor={upcoming ? textColor : colors.text} />
          </>
        ) : (
          <Text style={[styles.tournamentTitle, upcoming && { color: textColor }]} numberOfLines={2}>
            {event.title}
          </Text>
        )}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={[styles.status, upcoming && { color: textColor }]} numberOfLines={1}>
          {live
            ? event.statusDetail
            : upcoming
              ? formatUpcomingTime(event.startsAt) || event.statusDetail
              : event.statusDetail}
        </Text>
        {event.broadcast ? (
          <View style={[styles.broadcastPill, upcoming && styles.broadcastPillUpcoming]}>
            <Text style={[styles.broadcastText, upcoming && styles.broadcastTextUpcoming]} numberOfLines={1}>
              {event.broadcast}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

// ── Shelf ──

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
    paddingTop: spacing.md + 6, // room for the live accent bar
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 6,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.35)',
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
  broadcastPillUpcoming: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  broadcastText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  broadcastTextUpcoming: { color: '#111' },
});
