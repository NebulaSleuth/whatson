import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator,
  Dimensions, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LiveChannel } from '@whatson/shared';
import { ErrorState } from '@/components/ErrorState';
import { api, resolveArtworkUrl } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { colors, spacing, typography } from '@/constants/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_PADDING = spacing.md * 2;

// Tile sizing — square cards, more columns on TV than phone.
const TILE_MARGIN = spacing.md;
const TILE_TARGET_W = isTV ? 220 : 140;
const NUM_COLUMNS = Math.max(2, Math.floor((SCREEN_WIDTH - GRID_PADDING) / (TILE_TARGET_W + TILE_MARGIN)));
const TILE_W = Math.floor((SCREEN_WIDTH - GRID_PADDING - TILE_MARGIN * (NUM_COLUMNS - 1)) / NUM_COLUMNS);
const TILE_H = Math.floor(TILE_W * 0.75); // 4:3-ish; logos vary

const ChannelTile = React.memo(function ChannelTile({
  channel, onPress, hasTVPreferredFocus,
}: {
  channel: LiveChannel;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const hasLogo = !!channel.logoUrl;

  return (
    <Pressable
      style={[styles.tile, { width: TILE_W, height: TILE_H }, isTV && focused && styles.tileFocused]}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      focusable={true}
      {...(hasTVPreferredFocus ? { hasTVPreferredFocus: true } : {})}
    >
      {hasLogo ? (
        <Image
          source={{ uri: resolveArtworkUrl(channel.logoUrl!, { w: 360 }) }}
          style={styles.logo}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : (
        // Fallback when the source doesn't provide a logo (HDHomeRun
        // lineup.json doesn't include them in Phase 1). Big channel
        // number + call sign reads clearly across the room.
        <View style={styles.fallback}>
          <Text style={styles.channelNumber}>{channel.number || channel.name}</Text>
          <Text style={styles.callSign} numberOfLines={1}>
            {channel.callSign || channel.name}
          </Text>
        </View>
      )}
      {channel.hd && <View style={styles.hdBadge}><Text style={styles.hdText}>HD</Text></View>}
    </Pressable>
  );
});

export default function LiveTVScreen() {
  const { data: channels, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['live', 'tuner-channels'],
    queryFn: () => api.getLiveTunerChannels('all'),
  });

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
          <ChannelTile
            channel={item}
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
  row: { gap: TILE_MARGIN, marginBottom: TILE_MARGIN },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  tileFocused: {
    borderColor: colors.focus,
    transform: [{ scale: 1.04 }],
  },
  logo: { width: '100%', height: '100%' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  channelNumber: { fontSize: isTV ? 36 : 26, fontWeight: '800', color: colors.text },
  callSign: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  hdBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  hdText: { fontSize: 10, fontWeight: '800', color: '#000' },
});
