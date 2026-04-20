import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  FlatList, ScrollView, findNodeHandle, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ContentItem } from '@whatson/shared';
import { api, resolveArtworkUrl } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { colors, spacing, typography } from '@/constants/theme';

interface Season {
  ratingKey: string;
  index: number;
  title: string;
  episodeCount: number;
  watchedCount: number;
  thumb: string;
}

export default function ShowDetailScreen() {
  const { ratingKey, title, poster, summary, year } = useLocalSearchParams<{
    ratingKey: string; title: string; poster: string; summary: string; year: string;
  }>();

  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [focusedEpId, setFocusedEpId] = useState<string | null>(null);
  const episodeListRef = React.useRef<FlatList>(null);
  const [selectedSeasonNodeId, setSelectedSeasonNodeId] = useState<number | undefined>(undefined);
  const [firstEpisodeNodeId, setFirstEpisodeNodeId] = useState<number | undefined>(undefined);

  console.log('[ShowDetail] render: ratingKey=' + ratingKey + ' title=' + title);

  React.useEffect(() => {
    console.log('[ShowDetail] mounted');
    return () => console.log('[ShowDetail] unmounted');
  }, []);

  // Fetch seasons
  const { data: seasons, isLoading: loadingSeasons } = useQuery({
    queryKey: ['show-seasons', ratingKey],
    queryFn: () => api.getShowSeasons(ratingKey!),
    enabled: !!ratingKey,
  });

  // Auto-select first season
  React.useEffect(() => {
    if (seasons?.length && !selectedSeason) {
      setSelectedSeason(seasons[0]);
    }
  }, [seasons, selectedSeason]);

  // Fetch episodes for selected season
  const { data: episodes, isLoading: loadingEpisodes } = useQuery({
    queryKey: ['season-episodes', selectedSeason?.ratingKey],
    queryFn: () => api.getSeasonEpisodes(selectedSeason!.ratingKey),
    enabled: !!selectedSeason,
  });

  const handlePlayEpisode = useCallback((ep: ContentItem) => {
    router.push({ pathname: '/player', params: { ratingKey: ep.sourceId } } as any);
  }, []);

  const queryClient = useQueryClient();

  const showFullyWatched = !!seasons && seasons.length > 0 &&
    seasons.every((s) => s.episodeCount > 0 && s.watchedCount >= s.episodeCount);
  const seasonFullyWatched = !!selectedSeason &&
    selectedSeason.episodeCount > 0 &&
    selectedSeason.watchedCount >= selectedSeason.episodeCount;

  const invalidateShow = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['show-seasons', ratingKey] }),
      queryClient.invalidateQueries({ queryKey: ['season-episodes'] }),
      queryClient.invalidateQueries({ queryKey: ['home'] }),
      queryClient.invalidateQueries({ queryKey: ['tv'] }),
    ]);
  }, [queryClient, ratingKey]);

  const toggleShowWatched = useCallback(async () => {
    if (!ratingKey) return;
    try {
      if (showFullyWatched) await api.markUnwatched(ratingKey, 'plex');
      else await api.markWatched(ratingKey, 'plex');
      await invalidateShow();
    } catch (error) {
      Alert.alert('Error', (error as Error).message);
    }
  }, [ratingKey, showFullyWatched, invalidateShow]);

  const toggleSeasonWatched = useCallback(async () => {
    if (!selectedSeason) return;
    try {
      if (seasonFullyWatched) await api.markUnwatched(selectedSeason.ratingKey, 'plex');
      else await api.markWatched(selectedSeason.ratingKey, 'plex');
      await invalidateShow();
    } catch (error) {
      Alert.alert('Error', (error as Error).message);
    }
  }, [selectedSeason, seasonFullyWatched, invalidateShow]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with show info */}
      <View style={styles.header}>
        <Image
          source={{ uri: resolveArtworkUrl(poster || '') }}
          style={styles.poster}
          contentFit="cover"
          cachePolicy="disk"
        />
        <View style={styles.headerInfo}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {year ? <Text style={styles.year}>{year}</Text> : null}
          {summary ? <Text style={styles.summary} numberOfLines={isTV ? 3 : 4}>{summary}</Text> : null}
          {seasons && seasons.length > 0 && (
            <Pressable
              style={({ focused }) => [styles.markButton, isTV && focused && styles.markButtonFocused]}
              onPress={toggleShowWatched}
              focusable
            >
              <Text style={styles.markButtonText}>
                {showFullyWatched ? 'Mark All as Unwatched' : 'Mark Show as Watched'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Season tabs */}
      {seasons && seasons.length > 0 && (
        <View style={styles.seasonTabs}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasonTabsContent}>
            {seasons.map((season, idx) => (
              <Pressable
                key={season.ratingKey}
                ref={(ref) => {
                  if (isTV && ref && selectedSeason?.ratingKey === season.ratingKey) {
                    const nodeId = findNodeHandle(ref);
                    if (nodeId) setSelectedSeasonNodeId(nodeId);
                  }
                }}
                style={({ focused }) => [
                  styles.seasonTab,
                  selectedSeason?.ratingKey === season.ratingKey && styles.seasonTabActive,
                  isTV && focused && styles.seasonTabFocused,
                ]}
                onPress={() => setSelectedSeason(season)}
                onFocus={() => { if (isTV) setSelectedSeason(season); }}
                focusable
                {...(idx === 0 && isTV ? { hasTVPreferredFocus: true } : {})}
                {...(isTV && firstEpisodeNodeId ? { nextFocusDown: firstEpisodeNodeId } : {})}
              >
                <Text style={[
                  styles.seasonTabText,
                  selectedSeason?.ratingKey === season.ratingKey && styles.seasonTabTextActive,
                ]}>
                  {season.title}
                </Text>
                <Text style={styles.seasonEpCount}>{season.episodeCount} ep</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Season-level mark button */}
      {selectedSeason && !loadingSeasons && (
        <View style={styles.seasonActionRow}>
          <Pressable
            style={({ focused }) => [styles.markButton, isTV && focused && styles.markButtonFocused]}
            onPress={toggleSeasonWatched}
            focusable
          >
            <Text style={styles.markButtonText}>
              {seasonFullyWatched ? 'Mark Season as Unwatched' : 'Mark Season as Watched'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Episodes list */}
      {loadingSeasons || loadingEpisodes ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Pressable
            style={styles.loadingBackButton}
            onPress={() => router.back()}
            focusable
            hasTVPreferredFocus={true}
          >
            <Text style={styles.loadingBackText}>Loading...</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={episodeListRef}
          data={episodes || []}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <EpisodeRow
              episode={item}
              focused={focusedEpId === item.id}
              onPress={() => handlePlayEpisode(item)}
              onFocus={() => {
                setFocusedEpId(item.id);
                if (isTV && episodeListRef.current) {
                  episodeListRef.current.scrollToIndex({
                    index,
                    animated: true,
                    viewPosition: 0.2,
                  });
                }
              }}
              nextFocusUp={index === 0 ? selectedSeasonNodeId : undefined}
              tvRef={index === 0 ? (ref: any) => {
                if (isTV && ref) {
                  const nodeId = findNodeHandle(ref);
                  if (nodeId) setFirstEpisodeNodeId(nodeId);
                }
              } : undefined}
            />
          )}
          contentContainerStyle={styles.episodeList}
          windowSize={isTV ? 11 : 7}
          initialNumToRender={isTV ? 10 : 8}
          onScrollToIndexFailed={() => {}}
        />
      )}

      {/* Back button for phone */}
      {!isTV && (
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const EpisodeRow = React.memo(function EpisodeRow({
  episode, focused, onPress, onFocus, nextFocusUp, tvRef,
}: {
  episode: ContentItem; focused: boolean; onPress: () => void; onFocus: () => void;
  nextFocusUp?: number; tvRef?: (ref: any) => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const epLabel = episode.episodeNumber != null
    ? `E${String(episode.episodeNumber).padStart(2, '0')}`
    : '';
  const duration = episode.duration > 0 ? `${episode.duration}m` : '';
  const watched = episode.progress.watched;
  const hasProgress = episode.progress.percentage > 0 && !watched;

  return (
    <Pressable
      ref={tvRef}
      style={[styles.episodeRow, isTV && isFocused && styles.episodeRowFocused]}
      onPress={onPress}
      onFocus={() => { setIsFocused(true); onFocus(); }}
      onBlur={() => setIsFocused(false)}
      focusable
      {...(nextFocusUp ? { nextFocusUp } : {})}
    >
      {/* Thumbnail */}
      <View style={styles.episodeThumbnailContainer}>
        <Image
          source={{ uri: resolveArtworkUrl(episode.artwork.thumbnail) }}
          style={styles.episodeThumbnail}
          contentFit="cover"
          cachePolicy="disk"
          transition={0}
        />
        {hasProgress && (
          <View style={styles.episodeProgress}>
            <View style={[styles.episodeProgressFill, { width: `${episode.progress.percentage}%` }]} />
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.episodeInfo}>
        <View style={styles.episodeHeader}>
          <Text style={[styles.episodeNumber, watched && styles.episodeWatchedText]}>{epLabel}</Text>
          <View style={styles.episodeHeaderRight}>
            {duration ? <Text style={styles.episodeDuration}>{duration}</Text> : null}
            {watched && <Text style={styles.watchedCheck}>✓</Text>}
          </View>
        </View>
        <Text style={[styles.episodeTitle, watched && styles.episodeWatchedText]} numberOfLines={1}>
          {episode.title}
        </Text>
        {episode.summary ? (
          <Text style={styles.episodeSummary} numberOfLines={isTV ? 2 : 3}>
            {episode.summary}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const THUMB_W = isTV ? 200 : 140;
const THUMB_H = Math.round(THUMB_W * 9 / 16);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  poster: {
    width: isTV ? 120 : 100,
    height: isTV ? 180 : 150,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  headerInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    ...typography.title,
    fontSize: isTV ? 28 : 22,
  },
  year: {
    ...typography.caption,
    marginTop: 4,
  },
  summary: {
    ...typography.body,
    marginTop: spacing.sm,
    fontSize: isTV ? 14 : 13,
    lineHeight: isTV ? 20 : 18,
  },
  seasonTabs: {
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  seasonTabsContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  seasonTab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 20,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  seasonTabActive: {
    backgroundColor: colors.primary,
  },
  seasonTabFocused: {
    borderColor: colors.focus,
  },
  seasonTabText: {
    color: colors.textSecondary,
    fontSize: isTV ? 15 : 14,
    fontWeight: '600',
  },
  seasonTabTextActive: {
    color: '#000',
  },
  seasonEpCount: {
    color: colors.textMuted,
    fontSize: isTV ? 12 : 11,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingBackButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  loadingBackText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  episodeList: {
    padding: spacing.lg,
    paddingBottom: isTV ? 300 : 100,
  },
  episodeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    borderRadius: 8,
    padding: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  episodeRowFocused: {
    borderColor: colors.focus,
    backgroundColor: colors.surface,
  },
  episodeThumbnailContainer: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  episodeThumbnail: {
    width: '100%',
    height: '100%',
  },
  episodeProgress: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  episodeProgressFill: {
    height: 3,
    backgroundColor: colors.primary,
  },
  episodeHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  watchedCheck: {
    color: colors.success,
    fontSize: isTV ? 16 : 14,
    fontWeight: '700',
  },
  episodeInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  episodeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  episodeNumber: {
    color: colors.primary,
    fontSize: isTV ? 14 : 12,
    fontWeight: '700',
  },
  episodeDuration: {
    color: colors.textMuted,
    fontSize: isTV ? 12 : 11,
  },
  episodeTitle: {
    color: colors.text,
    fontSize: isTV ? 16 : 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  episodeSummary: {
    color: colors.textSecondary,
    fontSize: isTV ? 13 : 12,
    lineHeight: isTV ? 18 : 16,
  },
  episodeWatchedText: {
    color: colors.textMuted,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  markButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  markButtonFocused: {
    borderColor: colors.focus,
  },
  markButtonText: {
    color: colors.text,
    fontSize: isTV ? 14 : 13,
    fontWeight: '600',
  },
  seasonActionRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});
