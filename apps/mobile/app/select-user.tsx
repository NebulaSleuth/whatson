import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  Alert, TextInput, Modal, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useAppStore, type PlexUser } from '@/lib/store';
import { setSavedUser } from '@/lib/storage';
import { isTV } from '@/lib/tv';
import { colors, spacing, typography } from '@/constants/theme';

export default function SelectUserScreen() {
  const [pinUserId, setPinUserId] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [selecting, setSelecting] = useState(false);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const rememberUser = useAppStore((s) => s.rememberUser);
  const queryClient = useQueryClient();

  const { data: users, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
  });

  const handleSelectUser = useCallback(async (user: PlexUser) => {
    if (user.hasPassword) {
      setPinUserId(user.id);
      setPin('');
      return;
    }

    setSelecting(true);
    try {
      await api.selectUser(user.id);
      setCurrentUser(user);
      if (rememberUser) await setSavedUser({ id: user.id, title: user.title, thumb: user.thumb });
      queryClient.clear();
      router.replace('/(tabs)');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSelecting(false);
    }
  }, [setCurrentUser, queryClient]);

  const handlePinSubmit = useCallback(async () => {
    if (!pinUserId || !pin) return;

    setSelecting(true);
    try {
      await api.selectUser(pinUserId, pin);
      const user = users?.find((u) => u.id === pinUserId);
      if (user) {
        setCurrentUser(user);
        if (rememberUser) await setSavedUser({ id: user.id, title: user.title, thumb: user.thumb });
      }
      queryClient.clear();
      setPinUserId(null);
      router.replace('/(tabs)');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('PIN') || msg.includes('401') || msg.includes('Unauthorized')) {
        Alert.alert('Incorrect PIN', 'Please try again.');
      } else {
        Alert.alert('Error', msg);
      }
      setPin('');
    } finally {
      setSelecting(false);
    }
  }, [pinUserId, pin, users, setCurrentUser, queryClient]);

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
          {error ? (error as Error).message : 'No users found. Check Plex configuration.'}
        </Text>
        <Pressable style={styles.retryButton} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.retryText}>Continue without user</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Who's Watching?</Text>

      <View style={styles.grid}>
        {users.map((user) => (
          <Pressable
            key={user.id}
            style={({ focused }) => [styles.userCard, isTV && focused && styles.userCardFocused]}
            onPress={() => handleSelectUser(user)}
            disabled={selecting}
            focusable
          >
            {user.thumb ? (
              <Image
                source={{ uri: user.thumb }}
                style={styles.avatar}
                contentFit="cover"
                cachePolicy="disk"
              />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarLetter}>
                  {user.title.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.userName} numberOfLines={1}>{user.title}</Text>
            {user.hasPassword && <Text style={styles.pinIcon}>&#128274;</Text>}
          </Pressable>
        ))}
      </View>

      {selecting && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {/* PIN Entry Modal */}
      <Modal visible={pinUserId !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.pinModal}>
            <Text style={styles.pinTitle}>Enter PIN</Text>
            <Text style={styles.pinSubtitle}>
              {users.find((u) => u.id === pinUserId)?.title}
            </Text>
            <TextInput
              style={styles.pinInput}
              value={pin}
              onChangeText={setPin}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  title: {
    ...typography.title,
    fontSize: isTV ? 36 : 28,
    textAlign: 'center',
    marginBottom: isTV ? 48 : 32,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: isTV ? 32 : 20,
    paddingHorizontal: spacing.xl,
  },
  userCard: {
    alignItems: 'center',
    width: AVATAR_SIZE + 24,
    padding: 12,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  userCardFocused: {
    borderColor: colors.focus,
    backgroundColor: colors.surface,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.surface,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  avatarLetter: {
    fontSize: isTV ? 48 : 32,
    fontWeight: '700',
    color: '#000',
  },
  userName: {
    ...typography.cardTitle,
    marginTop: 8,
    textAlign: 'center',
  },
  pinIcon: {
    fontSize: 12,
    marginTop: 4,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
    borderRadius: 8,
  },
  retryText: {
    ...typography.body,
    color: colors.text,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinModal: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 32,
    width: isTV ? 400 : 300,
    alignItems: 'center',
  },
  pinTitle: {
    ...typography.title,
    fontSize: isTV ? 28 : 22,
    marginBottom: 8,
  },
  pinSubtitle: {
    ...typography.body,
    marginBottom: 24,
  },
  pinInput: {
    width: '100%',
    fontSize: isTV ? 32 : 24,
    textAlign: 'center',
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    letterSpacing: 8,
    marginBottom: 24,
  },
  pinButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  pinButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  pinCancel: {
    backgroundColor: '#333',
  },
  pinSubmit: {
    backgroundColor: colors.primary,
  },
  pinButtonFocused: {
    borderWidth: 3,
    borderColor: colors.focus,
  },
  pinButtonText: {
    fontSize: isTV ? 18 : 16,
    fontWeight: '600',
    color: colors.text,
  },
});
