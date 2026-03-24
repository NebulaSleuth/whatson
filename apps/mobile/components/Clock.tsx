import React, { useState, useEffect } from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors } from '@/constants/theme';
import { isTV } from '@/lib/tv';

export function Clock() {
  const [time, setTime] = useState(formatTime());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(formatTime());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return <Text style={styles.clock}>{time}</Text>;
}

function formatTime(): string {
  const now = new Date();
  return now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

const styles = StyleSheet.create({
  clock: {
    color: colors.textSecondary,
    fontSize: isTV ? 16 : 13,
    fontWeight: '500',
  },
});
