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
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    maxWidth: 120,
  },
  text: {
    fontSize: 10,
    fontWeight: '700',
    color: '#000',
    textTransform: 'uppercase',
  },
});
