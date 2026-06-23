import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  Alert, TextInput, Modal,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { setSavedUser } from '@/lib/storage';
import { isTV } from '@/lib/tv';
import { colors, spacing, typography } from '@/constants/theme';

interface WhatsOnUserCard {
  id: string;
  name: string;
  avatar: string;
  hasPin: boolean;
}

interface AvatarMeta {
  key: string;
  label: string;
  bg: string;
  emoji: string;
}

const FALLBACK_AVATAR: AvatarMeta = { key: 'default', label: 'Default', bg: colors.surface, emoji: '👤' };

export default function SelectWhatsOnUserScreen() {
  const [pinUserId, setPinUserId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [selecting, setSelecting] = useState(false);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const rememberUser = useAppStore((s) => s.rememberUser);
  const queryClient = useQueryClient();

  const { data: users, isLoading, error } = useQuery({
    queryKey: ['whatson-users'],
    queryFn: api.getWhatsOnUsers,
  });

  const { data: avatars } = useQuery({
    queryKey: ['whatson-avatars'],
    queryFn: api.getWhatsOnAvatars,
    staleTime: 60 * 60 * 1000, // avatar catalog rarely changes
  });

  const avatarByKey = useMemo(() => {
    const map = new Map<string, AvatarMeta>();
    for (const a of avatars || []) map.set(a.key, a);
    return map;
  }, [avatars]);

  const resolveAvatar = useCallback(
    (key: string): AvatarMeta => avatarByKey.get(key) || FALLBACK_AVATAR,
    [avatarByKey],
  );

  const completeLogin = useCallback(async (user: WhatsOnUserCard) => {
    // We carry the avatar key in `thumb` so the rest of the app — which
    // already renders thumb URLs — can still surface the user image
    // anywhere needed. The settings/header components will look it up
    // through the catalog the same way.
    const current = {
      id: user.id,
      kind: 'whatson' as const,
      title: user.name,
      thumb: user.avatar,
      hasPassword: user.hasPin,
    };
    setCurrentUser(current);
    if (rememberUser) {
      await setSavedUser({
        id: current.id,
        kind: 'whatson',
        title: current.title,
        thumb: current.thumb,
      });
    }
    queryClient.clear();
    router.replace('/(tabs)');
  }, [setCurrentUser, rememberUser, queryClient]);

  const handleSelectUser = useCallback(async (user: WhatsOnUserCard) => {
    if (user.hasPin) {
      setPinUserId(user.id);
      setPin('');
      return;
    }
    setSelecting(true);
    try {
      await api.selectWhatsOnUser(user.id);
      await completeLogin(user);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSelecting(false);
    }
  }, [completeLogin]);

  const handlePinSubmit = useCallback(async () => {
    if (!pinUserId || !pin) return;
    setSelecting(true);
    try {
      await api.selectWhatsOnUser(pinUserId, pin);
      const user = users?.find((u) => u.id === pinUserId);
      if (user) await completeLogin(user);
      setPinUserId(null);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.toLowerCase().includes('pin') || msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        Alert.alert('Incorrect PIN', 'Please try again.');
      } else {
        Alert.alert('Error', msg);
      }
      setPin('');
    } finally {
      setSelecting(false);
    }
  }, [pinUserId, pin, users, completeLogin]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !users?.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          {error
            ? (error as Error).message
            : 'No users configured yet. Open the admin /setup page to add one.'}
        </Text>
        <Pressable style={styles.retryButton} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.retryText}>Continue anyway</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Who's Watching?</Text>

      <View style={styles.grid}>
        {users.map((user, index) => {
          const av = resolveAvatar(user.avatar);
          return (
            <Pressable
              key={user.id}
              style={({ focused }) => [styles.userCard, isTV && focused && styles.userCardFocused]}
              onPress={() => handleSelectUser(user)}
              disabled={selecting}
              focusable
              {...(isTV && index === 0 ? { hasTVPreferredFocus: true } : {})}
            >
              <View style={[styles.avatar, { backgroundColor: av.bg }]}>
                <Text style={styles.avatarEmoji}>{av.emoji}</Text>
              </View>
              <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
              {user.hasPin && <Text style={styles.pinIcon}>&#128274;</Text>}
            </Pressable>
          );
        })}
      </View>

      {selecting && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      <Modal visible={pinUserId !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.pinModal}>
            <Text style={styles.pinTitle}>Enter PIN</Text>
            <Text style={styles.pinSubtitle}>
              {users.find((u) => u.id === pinUserId)?.name}
            </Text>
            <TextInput
              style={styles.pinInput}
              value={pin}
              onChangeText={setPin}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={8}
              autoFocus={!isTV}
              placeholder="----"
              placeholderTextColor="#555"
              onSubmitEditing={handlePinSubmit}
            />
            <View style={styles.pinButtons}>
              <Pressable
                style={({ focused }) => [styles.pinButton, styles.pinCancel, isTV && focused && styles.pinButtonFocused]}
                onPress={() => { setPinUserId(null); setPin(''); }}
                focusable
              >
                <Text style={styles.pinButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ focused }) => [styles.pinButton, styles.pinSubmit, isTV && focused && styles.pinButtonFocused]}
                onPress={handlePinSubmit}
                disabled={!pin || selecting}
                focusable
              >
                <Text style={[styles.pinButtonText, { color: '#000' }]}>
                  {selecting ? 'Signing in...' : 'OK'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const AVATAR_SIZE = isTV ? 120 : 80;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
  center: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  title: { ...typography.title, fontSize: isTV ? 36 : 28, textAlign: 'center', marginBottom: isTV ? 48 : 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: isTV ? 32 : 20, paddingHorizontal: spacing.xl },
  userCard: { alignItems: 'center', width: AVATAR_SIZE + 24, padding: 12, borderRadius: 12, borderWidth: 3, borderColor: 'transparent' },
  userCardFocused: { borderColor: colors.focus, backgroundColor: colors.surface },
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: AVATAR_SIZE * 0.6, lineHeight: AVATAR_SIZE * 0.85, includeFontPadding: false, textAlign: 'center' },
  userName: { ...typography.cardTitle, marginTop: 8, textAlign: 'center' },
  pinIcon: { fontSize: 12, marginTop: 4 },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center', marginBottom: 16 },
  retryButton: { paddingVertical: 12, paddingHorizontal: 24, backgroundColor: colors.surface, borderRadius: 8 },
  retryText: { ...typography.body, color: colors.text },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  pinModal: { backgroundColor: colors.surface, borderRadius: 16, padding: 32, width: isTV ? 400 : 300, alignItems: 'center' },
  pinTitle: { ...typography.title, fontSize: isTV ? 28 : 22, marginBottom: 8 },
  pinSubtitle: { ...typography.body, marginBottom: 24 },
  pinInput: { width: '100%', fontSize: isTV ? 32 : 24, textAlign: 'center', color: colors.text, backgroundColor: colors.background, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, letterSpacing: 8, marginBottom: 24 },
  pinButtons: { flexDirection: 'row', gap: 12 },
  pinButton: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, minWidth: 100, alignItems: 'center' },
  pinCancel: { backgroundColor: '#333' },
  pinSubmit: { backgroundColor: colors.primary },
  pinButtonFocused: { borderWidth: 3, borderColor: colors.focus },
  pinButtonText: { fontSize: isTV ? 18 : 16, fontWeight: '600', color: colors.text },
});
