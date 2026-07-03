import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ContentSource } from '@whatson/shared';
import { SOURCE_LABELS } from '@whatson/shared';
import { colors, spacing } from '@/constants/theme';

interface SourceBadgeProps {
  source: ContentSource;
  label?: string; // Override label (e.g., "YouTube TV" instead of "Live TV")
}

const badgeColors: Record<ContentSource, string> = {
  plex: colors.sourcePlex,
  jellyfin: colors.sourceJellyfin,
  emby: colors.sourceEmby,
  sonarr: colors.sourceSonarr,
  radarr: colors.sourceRadarr,
  live: colors.sourceLive,
};

export function SourceBadge({ source, label }: SourceBadgeProps) {
  const displayLabel = label || SOURCE_LABELS[source];
  return (
    <View style={[styles.badge, { backgroundColor: badgeColors[source] }]}>
      <Text style={styles.text} numberOfLines={1}>{displayLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    alignSelf: 'flex-start',
    maxWidth: 100,
  },
  text: {
    fontSize: 8,
    fontWeight: '700',
    color: '#000',
    textTransform: 'uppercase',
  },
});
