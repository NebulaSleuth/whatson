import React, { useCallback, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, findNodeHandle, Platform } from 'react-native';
import { Image } from 'expo-image';
import type { ContentItem } from '@whatson/shared';
import { SourceBadge } from './SourceBadge';
import { isTV } from '@/lib/tv';
import { ProgressBar } from './ProgressBar';
import { colors, spacing, cardDimensions, typography } from '@/constants/theme';
import { api, resolveArtworkUrl } from '@/lib/api';

function formatAvailableDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((dateLocal.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24));
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  // Today — show time
  if (diffDays === 0) return timeStr;

  // Future
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays <= 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }
  if (diffDays > 7) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Past
  if (diffDays === -1) return 'Yesterday';
  if (diffDays >= -6) {
    return 'Last ' + date.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface ContentCardProps {
  item: ContentItem;
  onPress?: (item: ContentItem) => void;
  onMarkWatched?: () => void;
  onTVFocus?: () => void;
  onTVBlur?: () => void;
  isFirstInRow?: boolean;
  isLastInRow?: boolean;
  tvRef?: (ref: any) => void;
  nextFocusUp?: number;
  nextFocusDown?: number;
  hasTVPreferredFocus?: boolean;
}

export const ContentCard = React.memo(function ContentCard({ item, onPress, onMarkWatched, onTVFocus, onTVBlur, isFirstInRow, isLastInRow, tvRef, nextFocusUp, nextFocusDown, hasTVPreferredFocus }: ContentCardProps) {
  const episodeLabel =
    item.type === 'episode' && item.seasonNumber != null && item.episodeNumber != null
      ? `S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}`
      : null;

  const displayTitle = item.showTitle || item.title;
  const subtitle = item.showTitle ? item.title : null;

  const isTrackedItem = item.id.startsWith('tracked-');

  const isTvShow = item.type === 'episode' || item.type === 'show';

  const handleLongPress = useCallback(() => {
    const buttons: any[] = [];

    if (isTrackedItem) {
      // Mark tracked item as watched
      buttons.push({
        text: 'Mark as Watched',
        onPress: async () => {
          try {
            console.log('[Card] marking watched:', item.id, item.source, item.sourceId);
            await api.markWatched(item.sourceId, item.source, item.id);
            console.log('[Card] markWatched success, calling onMarkWatched:', !!onMarkWatched);
            onMarkWatched?.();
          } catch (error) {
            console.error('[Card] markWatched error:', (error as Error).message);
            Alert.alert('Error', (error as Error).message);
          }
        },
      });
      buttons.push({
        text: 'Remove from Watchlist',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.removeTracked(parseInt(item.sourceId));
            onMarkWatched?.();
          } catch (error) {
            Alert.alert('Error', (error as Error).message);
          }
        },
      });
    } else if (item.status === 'ready' || item.status === 'watching') {
      buttons.push({
        text: item.progress.watched ? 'Mark as Unwatched' : 'Mark as Watched',
        onPress: async () => {
          try {
            if (item.progress.watched) {
              await api.markUnwatched(item.sourceId, item.source);
            } else {
              await api.markWatched(item.sourceId, item.source, item.id);
            }
            onMarkWatched?.();
          } catch (error) {
            Alert.alert('Error', (error as Error).message);
          }
        },
      });

      // For TV shows, add "Mark All as Watched"
      if (isTvShow && (item.showTitle || item.title)) {
        buttons.push({
          text: 'Mark All as Watched',
          onPress: async () => {
            try {
              await api.markAllWatched(
                item.showTitle || item.title,
                item.source,
                item.sourceId,
              );
              onMarkWatched?.();
            } catch (error) {
              Alert.alert('Error', (error as Error).message);
            }
          },
        });
      }
    }

    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(displayTitle, 'Choose an action', buttons);
  }, [item, displayTitle, onMarkWatched, isTrackedItem, isTvShow]);

  const [focused, setFocused] = useState(false);
  const [selfNodeId, setSelfNodeId] = useState<number | undefined>(undefined);

  const handleRef = useCallback((ref: any) => {
    if (isTV && ref) {
      const nodeId = findNodeHandle(ref);
      if (nodeId) setSelfNodeId(nodeId);
    }
    tvRef?.(ref);
  }, [tvRef]);

  const handlePress = useCallback(() => onPress?.(item), [onPress, item]);
  const handleFocus = useCallback(() => { setFocused(true); onTVFocus?.(); }, [onTVFocus]);
  const handleBlur = useCallback(() => { setFocused(false); onTVBlur?.(); }, [onTVBlur]);

  // Build directional focus overrides for Android TV
  const focusProps: any = {};
  if (isTV) {
    if (isFirstInRow && selfNodeId) focusProps.nextFocusLeft = selfNodeId;
    if (isLastInRow && selfNodeId) focusProps.nextFocusRight = selfNodeId;
    if (nextFocusUp) focusProps.nextFocusUp = nextFocusUp;
    if (nextFocusDown) focusProps.nextFocusDown = nextFocusDown;
    if (hasTVPreferredFocus) focusProps.hasTVPreferredFocus = true;
  }

  return (
    <Pressable
      ref={handleRef}
      onPress={handlePress}
      onLongPress={handleLongPress}
      onFocus={handleFocus}
      onBlur={handleBlur}
      android_ripple={isTV ? null : undefined}
      focusable={true}
      {...focusProps}
      style={({ pressed }) => [
        styles.container,
        pressed && !isTV && styles.pressed,
      ]}
    >
      <View style={[styles.posterWrapper, isTV && focused && styles.posterWrapperFocused]}>
        <View style={styles.posterContainer}>
          <Image
            source={{ uri: resolveArtworkUrl(item.artwork.poster) }}
            style={styles.poster}
            contentFit="cover"
            cachePolicy="disk"
            transition={isTV ? 0 : 200}
          />
          <ProgressBar percentage={item.progress.percentage} />
          <View style={styles.badgeContainer}>
            <SourceBadge
              source={item.source}
              label={item.source === 'live' ? item.availability.network : undefined}
            />
          </View>
          {item.source === 'live' && item.isRerun && (
            <View style={[styles.airingBanner, styles.airingRerun]}>
              <Text style={styles.airingBannerText}>RERUN</Text>
            </View>
          )}
          {item.groupCount && item.groupCount > 1 ? (
            <View style={styles.groupChip}>
              <Text style={styles.groupChipText}>+{item.groupCount - 1}</Text>
            </View>
          ) : null}
          {item.status === 'downloading' && (
            <View style={styles.statusOverlay}>
              <Text style={styles.downloadingText}>Downloading</Text>
            </View>
          )}
          {item.status === 'coming_soon' && item.availability.availableAt && (
            <View style={styles.statusOverlay}>
              <Text style={styles.comingSoonText}>{formatAvailableDate(item.availability.availableAt)}</Text>
            </View>
          )}
          {item.status === 'ready' && item.source === 'live' && item.availability.availableAt && (
            <View style={styles.statusOverlay}>
              <Text style={styles.comingSoonText}>{formatAvailableDate(item.availability.availableAt)}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.info}>
        <Text style={[styles.title, isTV && focused && styles.titleFocused]} numberOfLines={1}>
          {displayTitle}
        </Text>
        {subtitle && (
          <Text style={[styles.subtitle, isTV && focused && styles.subtitleFocused]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
        <View style={styles.metaRow}>
          {episodeLabel && <Text style={[styles.meta, isTV && focused && styles.metaFocused]}>{episodeLabel}</Text>}
          {item.duration > 0 && (
            <Text style={[styles.meta, isTV && focused && styles.metaFocused]}>
              {episodeLabel ? ' · ' : ''}
              {item.duration}m
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    width: isTV ? cardDimensions.poster.width + 6 : cardDimensions.poster.width,
    marginRight: isTV ? spacing.lg : spacing.md,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  posterWrapper: {
    borderRadius: 10,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  posterWrapperFocused: {
    borderColor: colors.focus,
  },
  posterContainer: {
    width: cardDimensions.poster.width,
    height: cardDimensions.poster.height,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  badgeContainer: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
  },
  airingBanner: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  airingRerun: {
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  airingBannerText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
  groupChip: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#000',
  },
  statusOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingVertical: 4,
    alignItems: 'center',
  },
  downloadingText: {
    fontSize: 10,
    color: colors.accent,
    fontWeight: '600',
  },
  comingSoonText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '700',
  },
  info: {
    marginTop: spacing.sm,
    width: cardDimensions.poster.width,
  },
  title: {
    ...typography.cardTitle,
  },
  subtitle: {
    ...typography.cardSubtitle,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  meta: {
    ...typography.caption,
  },
  titleFocused: {
    color: colors.focus,
  },
  subtitleFocused: {
    color: colors.text,
  },
  metaFocused: {
    color: colors.textSecondary,
  },
});
