import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, findNodeHandle } from 'react-native';
import { router } from 'expo-router';
import { colors, spacing, typography, cardDimensions } from '@/constants/theme';
import { isTV } from '@/lib/tv';

interface ViewAllCardProps {
  route: string;
  isLastInRow?: boolean;
  tvRef?: (ref: any) => void;
  nextFocusUp?: number;
  nextFocusDown?: number;
  hasTVPreferredFocus?: boolean;
}

/**
 * Trailing "View All" tile appended to the end of a shelf when its
 * ContentSection carries a `viewAllRoute`. Deliberately not a
 * ContentCard variant — the visual language is distinct (no poster
 * art, prominent arrow) so the user immediately reads it as an
 * action rather than a piece of content.
 */
export const ViewAllCard = React.memo(function ViewAllCard({
  route, isLastInRow, tvRef, nextFocusUp, nextFocusDown, hasTVPreferredFocus,
}: ViewAllCardProps) {
  const [focused, setFocused] = useState(false);
  const [selfNodeId, setSelfNodeId] = useState<number | undefined>(undefined);

  const handleRef = useCallback((ref: any) => {
    if (isTV && ref) {
      const nodeId = findNodeHandle(ref);
      if (nodeId) setSelfNodeId(nodeId);
    }
    tvRef?.(ref);
  }, [tvRef]);

  const onPress = useCallback(() => {
    router.navigate(route as any);
  }, [route]);

  const focusProps: any = {};
  if (isTV) {
    if (isLastInRow && selfNodeId) focusProps.nextFocusRight = selfNodeId;
    if (nextFocusUp) focusProps.nextFocusUp = nextFocusUp;
    if (nextFocusDown) focusProps.nextFocusDown = nextFocusDown;
    if (hasTVPreferredFocus) focusProps.hasTVPreferredFocus = true;
  }

  return (
    <Pressable
      ref={handleRef}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      android_ripple={isTV ? null : undefined}
      focusable={true}
      {...focusProps}
      style={styles.container}
    >
      <View style={[styles.tile, isTV && focused && styles.tileFocused]}>
        <Text style={[styles.arrow, focused && styles.arrowFocused]}>→</Text>
        <Text style={[styles.label, focused && styles.labelFocused]}>View All</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    width: isTV ? cardDimensions.poster.width + 6 : cardDimensions.poster.width,
    marginRight: isTV ? spacing.lg : spacing.md,
  },
  tile: {
    width: cardDimensions.poster.width,
    height: cardDimensions.poster.height,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  tileFocused: {
    borderColor: colors.focus,
  },
  arrow: {
    fontSize: 64,
    fontWeight: '300',
    color: colors.textSecondary,
    lineHeight: 68,
  },
  arrowFocused: {
    color: colors.focus,
  },
  label: {
    ...typography.cardTitle,
    color: colors.textSecondary,
  },
  labelFocused: {
    color: colors.focus,
  },
});
