import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator,
  Dimensions, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LiveChannel, LiveProgram } from '@whatson/shared';
import { ErrorState } from '@/components/ErrorState';
import { api, resolveArtworkUrl } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { colors, spacing, typography } from '@/constants/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_PADDING = spacing.md * 2;

// Wide horizontal cards — logo on left, info + EPG on right. Two
// columns on TV (Shield/AppleTV at 1920w), one column on phone.
const CARD_MARGIN = spacing.md;
const NUM_COLUMNS = isTV ? 2 : 1;
const CARD_W = Math.floor((SCREEN_WIDTH - GRID_PADDING - CARD_MARGIN * (NUM_COLUMNS - 1)) / NUM_COLUMNS);
const CARD_H = isTV ? 140 : 120;
const LOGO_W = isTV ? 160 : 110;

interface ProgramPair {
  now?: LiveProgram;
  next?: LiveProgram;
}

function buildEpgIndex(programs: LiveProgram[]): Map<string, ProgramPair> {
  const nowMs = Date.now();
  const byChannel = new Map<string, LiveProgram[]>();
  for (const p of programs) {
    if (!p.channelId) continue;
    const list = byChannel.get(p.channelId) || [];
    list.push(p);
    byChannel.set(p.channelId, list);
  }
  const out = new Map<string, ProgramPair>();
  for (const [chId, list] of byChannel) {
    list.sort((a, b) => a.startMs - b.startMs);
    const now = list.find((p) => p.startMs <= nowMs && nowMs < p.endMs);
    const next = list.find((p) => p.startMs > nowMs);
    out.set(chId, { now, next });
  }
  return out;
}

const ChannelCard = React.memo(function ChannelCard({
  channel, programs, onPress, hasTVPreferredFocus,
}: {
  channel: LiveChannel;
  programs: ProgramPair | undefined;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const hasLogo = !!channel.logoUrl;

  return (
    <Pressable
      style={[styles.card, { width: CARD_W, height: CARD_H }, isTV && focused && styles.cardFocused]}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      focusable={true}
      {...(hasTVPreferredFocus ? { hasTVPreferredFocus: true } : {})}
    >
      {/* Left: logo OR channel number fallback */}
      <View style={[styles.logoColumn, { width: LOGO_W }]}>
        {hasLogo ? (
          <Image
            source={{ uri: resolveArtworkUrl(channel.logoUrl!, { w: 360 }) }}
            style={styles.logo}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
          />
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.channelNumber}>{channel.number || ''}</Text>
            <Text style={styles.callSign} numberOfLines={1}>
              {channel.callSign || channel.name}
            </Text>
          </View>
        )}
      </View>

      {/* Right: header + EPG */}
      <View style={styles.infoColumn}>
        <View style={styles.headerRow}>
          {channel.number ? <Text style={styles.headerNumber}>{channel.number}</Text> : null}
          <Text style={styles.headerName} numberOfLines={1}>{channel.name || ''}</Text>
          {channel.hd && (
            <View style={styles.hdBadge}><Text style={styles.hdText}>HD</Text></View>
          )}
        </View>
        {programs?.now ? (
          <>
            <Text style={styles.epgLabel}>NOW</Text>
            <Text style={styles.epgNowTitle} numberOfLines={1}>
              {programs.now.title}
            </Text>
          </>
        ) : null}
        {programs?.next ? (
          <>
            <Text style={styles.epgLabelMuted}>NEXT</Text>
            <Text style={styles.epgNextTitle} numberOfLines={1}>
              {programs.next.title}
            </Text>
          </>
        ) : null}
      </View>
    </Pressable>
  );
});

export default function LiveTVScreen() {
  const { data: channels, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['live', 'tuner-channels'],
    queryFn: () => api.getLiveTunerChannels('all'),
  });

  // Fetch EPG once the channel list lands. Cards render with the
  // channel info immediately; EPG decorates them when the response
  // returns (typically 200-500ms after).
  const channelIds = useMemo(() => (channels || []).map((c) => c.id), [channels]);
  const { data: epgPrograms } = useQuery({
    queryKey: ['live', 'epg', channelIds.join(',')],
    queryFn: () => api.getLiveEpg(channelIds, 4),
    enabled: channelIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 min — matches backend cache window
  });

  const epgIndex = useMemo(() => buildEpgIndex(epgPrograms || []), [epgPrograms]);

  const handleTune = useCallback((channel: LiveChannel) => {
    router.push({
      pathname: '/player',
      params: { liveChannelId: channel.id },
    } as any);
  }, []);

  const sortedChannels = useMemo(() => channels ?? [], [channels]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ErrorState message={(error as Error).message} onRetry={refetch} />
      </SafeAreaView>
    );
  }

  if (!sortedChannels.length) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {!isTV && (
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Live TV</Text>
          </View>
        )}
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No live channels</Text>
          <Text style={styles.emptyBody}>
            Configure a tuner under /setup → Tuners on your backend. HDHomeRun is supported today; Plex / Jellyfin / Emby Live TV land in a follow-up.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {!isTV && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Live TV</Text>
          <Text style={styles.headerSub}>{sortedChannels.length} channels</Text>
        </View>
      )}
      <FlatList
        data={sortedChannels}
        keyExtractor={(c) => c.id}
        numColumns={NUM_COLUMNS}
        renderItem={({ item, index }) => (
          <ChannelCard
            channel={item}
            programs={epgIndex.get(item.id)}
            onPress={() => handleTune(item)}
            hasTVPreferredFocus={index === 0}
          />
        )}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={NUM_COLUMNS > 1 ? styles.row : undefined}
        refreshControl={
          isTV ? undefined : <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
  headerTitle: { ...typography.title, color: colors.text },
  headerSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { ...typography.sectionTitle, color: colors.text, marginBottom: spacing.sm },
  emptyBody: { ...typography.body, color: colors.textSecondary, textAlign: 'center', maxWidth: 420 },
  grid: { padding: spacing.md },
  row: { gap: CARD_MARGIN, marginBottom: CARD_MARGIN },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
    marginBottom: NUM_COLUMNS === 1 ? CARD_MARGIN : 0,
  },
  cardFocused: {
    borderColor: colors.focus,
    transform: [{ scale: 1.02 }],
  },
  logoColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    borderRightWidth: 1,
    borderRightColor: colors.cardBorder,
  },
  logo: { width: '100%', height: '100%' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  channelNumber: { fontSize: isTV ? 28 : 22, fontWeight: '800', color: colors.text },
  callSign: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  infoColumn: {
    flex: 1,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    justifyContent: 'flex-start',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  headerNumber: { fontSize: 14, fontWeight: '700', color: colors.focus },
  headerName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  hdBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  hdText: { fontSize: 10, fontWeight: '800', color: '#000' },
  epgLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, marginTop: 4 },
  epgLabelMuted: { fontSize: 10, fontWeight: '700', color: colors.textMuted, marginTop: 4 },
  epgNowTitle: { fontSize: 14, color: colors.focus, marginTop: 1 },
  epgNextTitle: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
});
