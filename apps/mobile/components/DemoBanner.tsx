import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsDemo, forgetServer } from '@/lib/demo';
import { colors, spacing } from '@/constants/theme';
import { isTV } from '@/lib/tv';

/**
 * Slim "Demo · read-only" strip shown app-wide while connected to the public
 * demo server, with a "Leave demo" action that forgets the server and returns
 * to /pair-device. Hidden in the player and on the pair screen.
 */
export function DemoBanner() {
  const demo = useIsDemo();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  if (!demo || pathname === '/player' || pathname === '/pair-device') return null;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 4 }]}>
      <Text style={styles.text}>Demo · read-only</Text>
      <Pressable
        onPress={() => void forgetServer()}
        focusable
        accessibilityRole="button"
        style={({ pressed, focused }) => [styles.leave, pressed && styles.pressed, focused && styles.focused]}>
        <Text style={styles.leaveText}>Leave demo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingBottom: 4,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
  },
  text: { color: colors.primary, fontWeight: '700', fontSize: isTV ? 18 : 12, letterSpacing: 0.5 },
  leave: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
  leaveText: { color: colors.text, fontWeight: '600', fontSize: isTV ? 18 : 12, textDecorationLine: 'underline' },
  pressed: { opacity: 0.7 },
  focused: { borderColor: colors.focus },
});
