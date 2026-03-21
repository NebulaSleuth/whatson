import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '@/constants/theme';

interface ProgressBarProps {
  percentage: number;
  height?: number;
}

export function ProgressBar({ percentage, height = 3 }: ProgressBarProps) {
  if (percentage <= 0) return null;

  return (
    <View style={[styles.track, { height }]}>
      <View
        style={[
          styles.fill,
          { width: `${Math.min(percentage, 100)}%`, height },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.15)',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  fill: {
    backgroundColor: colors.progressBar,
  },
});
