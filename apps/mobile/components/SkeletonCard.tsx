import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors, spacing, cardDimensions } from '@/constants/theme';

export function SkeletonCard() {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.poster, { opacity }]} />
      <Animated.View style={[styles.titleLine, { opacity }]} />
      <Animated.View style={[styles.subtitleLine, { opacity }]} />
    </View>
  );
}

export function SkeletonShelf() {
  return (
    <View style={styles.shelfContainer}>
      <View style={styles.shelfTitleSkeleton} />
      <View style={styles.shelfRow}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: cardDimensions.poster.width,
    marginRight: spacing.md,
  },
  poster: {
    width: cardDimensions.poster.width,
    height: cardDimensions.poster.height,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  titleLine: {
    width: '75%',
    height: 14,
    borderRadius: 4,
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
  },
  subtitleLine: {
    width: '50%',
    height: 12,
    borderRadius: 4,
    backgroundColor: colors.surface,
    marginTop: 4,
  },
  shelfContainer: {
    marginBottom: spacing.xl,
  },
  shelfTitleSkeleton: {
    width: 160,
    height: 18,
    borderRadius: 4,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
    marginHorizontal: spacing.lg,
  },
  shelfRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
  },
});
