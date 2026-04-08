import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Modal,
  TouchableWithoutFeedback,
  Dimensions,
  BackHandler,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import type { ContentItem } from '@whatson/shared';
import { SourceBadge } from './SourceBadge';
// Progress bar is inline in this component (not the absolute-positioned ProgressBar)
import { colors, spacing, typography } from '@/constants/theme';
import { api, resolveArtworkUrl } from '@/lib/api';
import { isTV } from '@/lib/tv';
import { hasVideoPlayer } from '@/lib/videoPlayer';
import { ArrAddPicker } from './ArrAddPicker';
import { router } from 'expo-router';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface DetailSheetProps {
  item: ContentItem;
  onClose: () => void;
  onRefresh?: () => void;
}

function FocusButton({
  title,
  style,
  textStyle,
  onPress,
  preferFocus,
}: {
  title: string;
  style: any;
  textStyle: any;
  onPress: () => void;
  preferFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable={true}
      hasTVPreferredFocus={preferFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[style, isTV && focused && styles.buttonFocused]}
    >
      <Text style={textStyle}>{title}</Text>
    </Pressable>
  );
}

export function DetailSheet({ item, onClose, onRefresh }: DetailSheetProps) {
  const episodeLabel =
    item.type === 'episode' && item.seasonNumber != null && item.episodeNumber != null
      ? `Season ${item.seasonNumber}, Episode ${item.episodeNumber}`
      : null;

  const isTrackedItem = item.id.startsWith('tracked-');
  const isDiscoveryItem = item.id.startsWith('tmdb-');
  const isTvShow = item.type === 'episode' || item.type === 'show';
  const [arrPickerType, setArrPickerType] = useState<'sonarr' | 'radarr' | null>(null);

  // On TV, handle back button to close the detail sheet
  React.useEffect(() => {
    if (!isTV) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [onClose]);

  const handleMarkWatched = () => {
    const title = item.showTitle || item.title;
    const label = episodeLabel ? `${title} - ${episodeLabel}` : title;
    Alert.alert('Mark as Watched', `Mark "${label}" as watched?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Watched',
        onPress: async () => {
          try {
            await api.markWatched(item.sourceId, item.source, item.id);
            onRefresh?.();
            onClose();
          } catch (error) {
            Alert.alert('Error', (error as Error).message);
          }
        },
      },
    ]);
  };

  const handleMarkAllWatched = () => {
    const showName = item.showTitle || item.title;
    Alert.alert('Mark All as Watched', `Mark all episodes of "${showName}" as watched?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark All Watched',
        onPress: async () => {
          try {
            await api.markAllWatched(showName, item.source, item.sourceId);
            onRefresh?.();
            onClose();
          } catch (error) {
            Alert.alert('Error', (error as Error).message);
          }
        },
      },
    ]);
  };

  const handleMarkAllUnwatched = () => {
    const showName = item.showTitle || item.title;
    Alert.alert('Mark All as Unwatched', `Mark all episodes of "${showName}" as unwatched?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark All Unwatched',
        onPress: async () => {
          try {
            await api.markAllUnwatched(item.sourceId, item.source);
            onRefresh?.();
            onClose();
          } catch (error) {
            Alert.alert('Error', (error as Error).message);
          }
        },
      },
    ]);
  };

  const isPlexItem = item.source === 'plex';

  const handlePlay = () => {
    onClose();
    router.push({ pathname: '/player', params: { ratingKey: item.sourceId } });
  };

  const handleOpenInPlex = async () => {
    try {
      const intentUrl = 'intent:#Intent;package=com.plexapp.android;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end';
      await Linking.openURL(intentUrl);
    } catch {
      try {
        await Linking.openURL('plex://');
      } catch {
        Alert.alert('Error', 'Could not open Plex. Is it installed?');
      }
    }
  };

  const handleRemoveTracked = () => {
    Alert.alert(
      'Remove from Tracked',
      `Remove "${item.title}" from your watchlist?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.removeTracked(parseInt(item.sourceId));
              onRefresh?.();
              onClose();
            } catch (error) {
              Alert.alert('Error', (error as Error).message);
            }
          },
        },
      ],
    );
  };

  return (<>
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <View style={styles.sheet}>
          {!isTV && (
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
          )}

          {isTV ? (
            <ScrollView style={styles.tvScrollContent} bounces={false}>
            <View style={styles.tvLayout}>
              {/* Left side: artwork */}
              <View style={styles.tvPoster}>
                <Image
                  source={{ uri: resolveArtworkUrl(item.artwork.poster || item.artwork.background) }}
                  style={styles.tvPosterImage}
                  contentFit="cover"
                  transition={0}
                />
              </View>

              {/* Right side: info + buttons */}
              <View style={styles.tvInfo}>
                <Text style={styles.tvTitle}>{item.showTitle || item.title}</Text>
                {item.showTitle && <Text style={styles.tvSubtitle}>{item.title}</Text>}

                <View style={styles.metaRow}>
                  <SourceBadge source={item.source} />
                  {item.availability.network ? (
                    <View style={styles.networkBadge}>
                      <Text style={styles.networkText}>{item.availability.network}</Text>
                    </View>
                  ) : null}
                  {episodeLabel ? <Text style={styles.metaText}>{episodeLabel}</Text> : null}
                  {item.year > 0 ? <Text style={styles.metaText}>{item.year}</Text> : null}
                  {item.duration > 0 ? <Text style={styles.metaText}>{item.duration} min</Text> : null}
                  {item.rating != null && item.rating > 0 ? (
                    <Text style={styles.metaText}>{item.rating.toFixed(1)}</Text>
                  ) : null}
                </View>

                {item.progress.percentage > 0 ? (
                  <View style={styles.progressSection}>
                    <Text style={styles.progressText}>{item.progress.percentage}% watched</Text>
                    <View style={styles.detailProgressTrack}>
                      <View style={[styles.detailProgressFill, { width: `${Math.min(item.progress.percentage, 100)}%` }]} />
                    </View>
                  </View>
                ) : null}

                {item.summary ? (
                  <Text style={styles.tvSummary} numberOfLines={3} ellipsizeMode="tail">{item.summary}</Text>
                ) : null}

                <View style={styles.tvActions}>
                  {isPlexItem && hasVideoPlayer ? (
                    <FocusButton
                      title="Play Here"
                      style={styles.playButton}
                      textStyle={styles.playButtonText}
                      onPress={handlePlay}
                      preferFocus={true}
                    />
                  ) : null}

                  {isPlexItem ? (
                    <FocusButton
                      title="Open in Plex"
                      style={styles.openPlexButton}
                      textStyle={styles.openPlexButtonText}
                      onPress={handleOpenInPlex}
                    />
                  ) : null}

                  {!isDiscoveryItem && (item.status === 'ready' || item.status === 'watching') && item.type !== 'show' ? (
                    <FocusButton
                      title="Mark as Watched"
                      style={styles.watchedButton}
                      textStyle={styles.watchedButtonText}
                      onPress={handleMarkWatched}
                      preferFocus={!isPlexItem}
                    />
                  ) : null}

                  {!isDiscoveryItem && isTvShow && (item.showTitle || item.title) ? (
                    <FocusButton
                      title="Mark All as Watched"
                      style={styles.watchedButton}
                      textStyle={styles.watchedButtonText}
                      onPress={handleMarkAllWatched}
                    />
                  ) : null}

                  {isDiscoveryItem && item.source === 'sonarr' ? (
                    <FocusButton
                      title="Add to Sonarr"
                      style={styles.playButton}
                      textStyle={styles.playButtonText}
                      onPress={() => setArrPickerType('sonarr')}
                      preferFocus={true}
                    />
                  ) : null}

                  {isDiscoveryItem && item.source === 'radarr' ? (
                    <FocusButton
                      title="Add to Radarr"
                      style={styles.playButton}
                      textStyle={styles.playButtonText}
                      onPress={() => setArrPickerType('radarr')}
                      preferFocus={true}
                    />
                  ) : null}

                  {isTrackedItem && isTvShow ? (
                    <FocusButton
                      title="Mark All as Unwatched"
                      style={styles.unwatchedButton}
                      textStyle={styles.unwatchedButtonText}
                      onPress={handleMarkAllUnwatched}
                    />
                  ) : null}

                  {isTrackedItem ? (
                    <FocusButton
                      title="Remove from Watchlist"
                      style={styles.removeButton}
                      textStyle={styles.removeButtonText}
                      onPress={handleRemoveTracked}
                    />
                  ) : null}

                </View>
              </View>
            </View>
            </ScrollView>
          ) : (
            /* Mobile: scrollable bottom sheet */
            <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={styles.scrollContent}>
              <View style={styles.heroContainer}>
                <Image
                  source={{ uri: resolveArtworkUrl(item.artwork.background || item.artwork.poster) }}
                  style={styles.heroImage}
                  contentFit="cover"
                  cachePolicy="disk"
                />
                <View style={styles.heroOverlay} />
                <View style={styles.heroContent}>
                  <Text style={styles.heroTitle}>{item.showTitle || item.title}</Text>
                  {item.showTitle && <Text style={styles.heroSubtitle}>{item.title}</Text>}
                </View>
              </View>

              <View style={styles.content}>
                <View style={styles.metaRow}>
                  <SourceBadge source={item.source} />
                  {item.availability.network ? (
                    <View style={styles.networkBadge}>
                      <Text style={styles.networkText}>{item.availability.network}</Text>
                    </View>
                  ) : null}
                  {episodeLabel ? <Text style={styles.metaText}>{episodeLabel}</Text> : null}
                  {item.year > 0 ? <Text style={styles.metaText}>{item.year}</Text> : null}
                  {item.duration > 0 ? <Text style={styles.metaText}>{item.duration} min</Text> : null}
                  {item.rating != null && item.rating > 0 ? (
                    <Text style={styles.metaText}>{item.rating.toFixed(1)}</Text>
                  ) : null}
                </View>

                {item.progress.percentage > 0 ? (
                  <View style={styles.progressSection}>
                    <Text style={styles.progressText}>{item.progress.percentage}% watched</Text>
                    <View style={styles.detailProgressTrack}>
                      <View style={[styles.detailProgressFill, { width: `${Math.min(item.progress.percentage, 100)}%` }]} />
                    </View>
                  </View>
                ) : null}

                {item.summary ? <Text style={styles.summary}>{item.summary}</Text> : null}

                {item.genres && item.genres.length > 0 ? (
                  <View style={styles.genreRow}>
                    {item.genres.map((genre) => (
                      <View key={genre} style={styles.genreChip}>
                        <Text style={styles.genreText}>{genre}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.actions}>
                  {isPlexItem && hasVideoPlayer ? (
                    <Pressable style={styles.playButton} onPress={handlePlay}>
                      <Text style={styles.playButtonText}>Play Here</Text>
                    </Pressable>
                  ) : null}

                  {isPlexItem ? (
                    <Pressable style={styles.openPlexButton} onPress={handleOpenInPlex}>
                      <Text style={styles.openPlexButtonText}>Open in Plex</Text>
                    </Pressable>
                  ) : null}

                  {!isDiscoveryItem && (item.status === 'ready' || item.status === 'watching') && item.type !== 'show' ? (
                    <Pressable style={styles.watchedButton} onPress={handleMarkWatched}>
                      <Text style={styles.watchedButtonText}>Mark as Watched</Text>
                    </Pressable>
                  ) : null}

                  {!isDiscoveryItem && isTvShow && (item.showTitle || item.title) ? (
                    <Pressable style={styles.watchedButton} onPress={handleMarkAllWatched}>
                      <Text style={styles.watchedButtonText}>Mark All as Watched</Text>
                    </Pressable>
                  ) : null}

                  {isDiscoveryItem && item.source === 'sonarr' ? (
                    <Pressable style={styles.playButton} onPress={() => setArrPickerType('sonarr')}>
                      <Text style={styles.playButtonText}>Add to Sonarr</Text>
                    </Pressable>
                  ) : null}

                  {isDiscoveryItem && item.source === 'radarr' ? (
                    <Pressable style={styles.playButton} onPress={() => setArrPickerType('radarr')}>
                      <Text style={styles.playButtonText}>Add to Radarr</Text>
                    </Pressable>
                  ) : null}

                  {isTrackedItem && isTvShow ? (
                    <Pressable style={styles.unwatchedButton} onPress={handleMarkAllUnwatched}>
                      <Text style={styles.unwatchedButtonText}>Mark All as Unwatched</Text>
                    </Pressable>
                  ) : null}

                  {isTrackedItem ? (
                    <Pressable style={styles.removeButton} onPress={handleRemoveTracked}>
                      <Text style={styles.removeButtonText}>Remove from Watchlist</Text>
                    </Pressable>
                  ) : null}

                  <Pressable style={styles.closeButton} onPress={onClose}>
                    <Text style={styles.closeButtonText}>Close</Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>

    {arrPickerType && (
      <ArrAddPicker
        visible={true}
        type={arrPickerType}
        item={{ title: item.title, tmdbId: parseInt(item.sourceId) }}
        onClose={() => setArrPickerType(null)}
        onSuccess={() => {
          setArrPickerType(null);
          onRefresh?.();
          onClose();
        }}
      />
    )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: isTV ? 'center' : 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: isTV ? 12 : 20,
    borderTopRightRadius: isTV ? 12 : 20,
    borderBottomLeftRadius: isTV ? 12 : 0,
    borderBottomRightRadius: isTV ? 12 : 0,
    maxHeight: isTV ? SCREEN_HEIGHT * 0.9 : SCREEN_HEIGHT * 0.85,
    minHeight: 300,
    ...(isTV ? { marginHorizontal: 40 } : {}),
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },

  // ── TV Layout ──
  tvScrollContent: {
    flexGrow: 0,
  },
  tvLayout: {
    flexDirection: 'row',
    padding: spacing.xl,
  },
  tvPoster: {
    width: 200,
    height: 300,
    borderRadius: 8,
    overflow: 'hidden',
    marginRight: spacing.xl,
  },
  tvPosterImage: {
    width: '100%',
    height: '100%',
  },
  tvInfo: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  tvTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  tvSubtitle: {
    fontSize: 18,
    fontWeight: '400',
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  tvSummary: {
    ...typography.body,
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  tvActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },

  // ── Mobile Layout ──
  scrollContent: {
    flexGrow: 0,
  },
  heroContainer: {
    height: 200,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  heroContent: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  heroSubtitle: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: 4,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  // ── Shared ──
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginBottom: spacing.lg,
  },
  metaText: {
    ...typography.body,
  },
  networkBadge: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  networkText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#000',
  },
  progressSection: {
    marginBottom: spacing.lg,
  },
  progressText: {
    ...typography.caption,
    marginBottom: spacing.xs,
  },
  detailProgressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    width: '100%',
  },
  detailProgressFill: {
    height: 4,
    backgroundColor: colors.progressBar,
    borderRadius: 2,
  },
  summary: {
    ...typography.body,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  genreChip: {
    backgroundColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 12,
  },
  genreText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actions: {
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  playButton: {
    backgroundColor: '#cc7b19',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  playButtonText: {
    fontSize: isTV ? 18 : 16,
    fontWeight: '700',
    color: '#fff',
  },
  openPlexButton: {
    backgroundColor: '#333',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  openPlexButtonText: {
    fontSize: isTV ? 18 : 16,
    fontWeight: '600',
    color: colors.primary,
  },
  watchedButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  watchedButtonText: {
    fontSize: isTV ? 18 : 16,
    fontWeight: '600',
    color: '#000',
  },
  unwatchedButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  unwatchedButtonText: {
    fontSize: isTV ? 18 : 16,
    fontWeight: '600',
    color: '#000',
  },
  removeButton: {
    backgroundColor: colors.error,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  removeButtonText: {
    fontSize: isTV ? 18 : 16,
    fontWeight: '600',
    color: '#fff',
  },
  closeButton: {
    backgroundColor: colors.cardBorder,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  closeButtonText: {
    fontSize: isTV ? 18 : 16,
    fontWeight: '600',
    color: colors.text,
  },
  buttonFocused: {
    borderColor: '#FFFFFF',
    borderWidth: 2,
  },
});
