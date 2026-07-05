import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, TextInput, ScrollView,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { setSavedUser } from '@/lib/storage';
import { reportGuestProfileToCloud } from '@/lib/cloudAuth';
import { isTV } from '@/lib/tv';
import { colors, spacing, typography } from '@/constants/theme';

/**
 * New-viewer setup (M7). A guest whose invite said "new viewer" (grant binding
 * 'locked-new'), or an open-mode guest adding a viewer, lands here after
 * connecting: they enter a name + pick an avatar, which creates their Whats On
 * user on the server (unmapped → inherits the server's default content with its
 * own watched state) and signs them in.
 */
export default function CreateProfileScreen() {
  const params = useLocalSearchParams<{ name?: string }>();
  const [name, setName] = useState((params.name as string) || '');
  const [avatarKey, setAvatarKey] = useState('default');
  const [saving, setSaving] = useState(false);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const rememberUser = useAppStore((s) => s.rememberUser);
  const queryClient = useQueryClient();

  const { data: avatars } = useQuery({
    queryKey: ['whatson-avatars'],
    queryFn: api.getWhatsOnAvatars,
    staleTime: 60 * 60 * 1000,
  });

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) { Alert.alert('Name required', 'Please enter a name for your profile.'); return; }
    setSaving(true);
    try {
      const user = await api.createGuestProfile(trimmed, avatarKey);
      // Bind this guest's other devices to the same viewer (best-effort).
      await reportGuestProfileToCloud(user.id);
      const current = { id: user.id, kind: 'whatson' as const, title: user.name, thumb: user.avatar, hasPassword: false };
      setCurrentUser(current);
      if (rememberUser) {
        await setSavedUser({ id: current.id, kind: 'whatson', title: current.title, thumb: current.thumb });
      }
      queryClient.clear();
      router.replace('/(tabs)');
    } catch (e) {
      Alert.alert('Could not create profile', (e as Error).message);
      setSaving(false);
    }
  }, [name, avatarKey, setCurrentUser, rememberUser, queryClient]);

  const list = avatars && avatars.length ? avatars : [{ key: 'default', label: 'Default', bg: colors.surface, emoji: '👤', url: '' }];

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Set up your profile</Text>
        <Text style={styles.subtitle}>Pick a name and avatar. This is how you'll show up on this server.</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor="#666"
          autoFocus={!isTV}
          maxLength={40}
        />

        <Text style={styles.label}>Avatar</Text>
        <View style={styles.grid}>
          {list.map((a, index) => {
            const selected = a.key === avatarKey;
            return (
              <Pressable
                key={a.key}
                onPress={() => setAvatarKey(a.key)}
                focusable
                {...(isTV && index === 0 ? { hasTVPreferredFocus: true } : {})}
                style={({ focused }) => [
                  styles.avatarCard,
                  selected && styles.avatarSelected,
                  isTV && focused && styles.avatarFocused,
                ]}
              >
                <View style={[styles.avatar, { backgroundColor: a.bg }]}>
                  <Text style={styles.avatarEmoji}>{a.emoji}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={create}
          disabled={saving}
          focusable
          style={({ pressed, focused }) => [styles.button, pressed && styles.buttonPressed, focused && styles.buttonFocused]}
        >
          {saving ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Start watching</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const AVATAR_SIZE = isTV ? 96 : 68;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxl },
  title: { ...typography.title, fontSize: isTV ? 34 : 28, color: colors.primary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  label: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    fontSize: isTV ? 24 : 18, color: colors.text, backgroundColor: colors.surface,
    borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.cardBorder,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: isTV ? 20 : 14 },
  avatarCard: { padding: 6, borderRadius: 14, borderWidth: 3, borderColor: 'transparent' },
  avatarSelected: { borderColor: colors.primary },
  avatarFocused: { borderColor: colors.focus, transform: [{ scale: 1.06 }] },
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: AVATAR_SIZE * 0.55, lineHeight: AVATAR_SIZE * 0.8, includeFontPadding: false, textAlign: 'center' },
  button: {
    marginTop: spacing.xl, backgroundColor: colors.primary, borderRadius: 10,
    paddingVertical: 16, alignItems: 'center', alignSelf: isTV ? 'flex-start' : 'stretch', paddingHorizontal: 40,
  },
  buttonPressed: { opacity: 0.8 },
  buttonFocused: { borderWidth: 3, borderColor: colors.focus, transform: [{ scale: 1.03 }] },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 18 },
});
