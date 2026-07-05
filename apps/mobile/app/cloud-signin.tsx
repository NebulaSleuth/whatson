import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '@/constants/theme';
import { startDeviceCode, pollDeviceCode, redeemGrantViaCandidates } from '@/lib/cloudAuth';

/**
 * "Sign in with Whats On" (M7). Onboards a device that was never on the server's
 * LAN: shows a short code, the owner approves it at whatsontv.net/link, and this
 * screen polls, then redeems the grant + connects. See lib/cloudAuth.ts.
 */
type Phase = 'starting' | 'waiting' | 'connecting' | 'error';

export default function CloudSignInScreen() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('whatsontv.net/link');
  const [errorMsg, setErrorMsg] = useState('');
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void begin();
    }
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function begin() {
    stopPolling();
    setPhase('starting');
    setErrorMsg('');
    try {
      const s = await startDeviceCode();
      setUserCode(s.userCode);
      setVerificationUri((s.verificationUri || 'https://whatsontv.net/link').replace(/^https?:\/\//, ''));
      setPhase('waiting');
      const intervalMs = Math.max(3, s.interval || 5) * 1000;
      pollTimer.current = setInterval(() => void poll(s.deviceCode), intervalMs);
    } catch (e) {
      setErrorMsg((e as Error).message);
      setPhase('error');
    }
  }

  async function poll(deviceCode: string) {
    try {
      const r = await pollDeviceCode(deviceCode);
      if (r.status === 'pending') return;
      stopPolling();
      if (r.status === 'approved') {
        setPhase('connecting');
        const result = await redeemGrantViaCandidates(r.grant, r.candidates, r.cloudToken);
        if (result.ok) {
          // Route by how the guest's profile is decided (M7):
          //  - locked-new → set up a new viewer (name + avatar)
          //  - open       → pick which viewer to watch as (Who's Watching?)
          //  - locked / owner → straight in (backend enforces the bound profile)
          if (result.guestBinding === 'locked-new') {
            router.replace(`/create-profile?name=${encodeURIComponent(result.newUserName || '')}` as any);
          } else if (result.guestBinding === 'open') {
            router.replace('/select-whatson-user' as any);
          } else {
            router.replace('/' as any);
          }
        } else {
          setErrorMsg(
            "Approved — but this device can't reach your server from here yet. Make sure remote " +
              'access is enabled and your server is online, then try again.',
          );
          setPhase('error');
        }
        return;
      }
      setErrorMsg(r.status === 'expired' ? 'The code expired. Let’s get a new one.' : 'The request was denied.');
      setPhase('error');
    } catch {
      // transient network error — keep polling
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.title}>Sign in with Whats On</Text>

        {phase === 'starting' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.status}>Getting your code…</Text>
          </View>
        )}

        {phase === 'waiting' && (
          <>
            <Text style={styles.subtitle}>
              On a computer or phone, open <Text style={styles.url}>{verificationUri}</Text>, sign in to your
              Whats On account, and enter this code:
            </Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeText}>{userCode}</Text>
            </View>
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.status}>Waiting for you to approve…</Text>
            </View>
          </>
        )}

        {phase === 'connecting' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.status}>Approved! Connecting to your server…</Text>
          </View>
        )}

        {phase === 'error' && (
          <>
            <Text style={styles.errorText}>{errorMsg}</Text>
            <Pressable
              onPress={() => void begin()}
              focusable
              style={({ pressed, focused }) => [styles.button, pressed && styles.buttonPressed, focused && styles.buttonFocused]}>
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </>
        )}

        <Pressable
          onPress={() => router.back()}
          focusable
          style={({ pressed, focused }) => [styles.button, styles.buttonSecondary, pressed && styles.buttonPressed, focused && styles.buttonFocused]}>
          <Text style={styles.buttonText}>Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, gap: spacing.lg },
  title: { ...typography.title, color: colors.primary, fontSize: 32 },
  subtitle: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
  url: { color: colors.text, fontWeight: '600' },
  center: { alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  status: { ...typography.body, color: colors.textSecondary },
  codeBox: {
    alignSelf: 'center',
    minWidth: 260,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  codeText: { fontSize: 44, fontWeight: '700', letterSpacing: 8, color: colors.primary },
  errorText: { ...typography.body, color: '#ff8888', lineHeight: 22 },
  button: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.cardBorder },
  buttonPressed: { opacity: 0.7 },
  buttonFocused: { borderWidth: 3, borderColor: colors.focus, transform: [{ scale: 1.05 }] },
  buttonText: { color: colors.text, fontWeight: '600', fontSize: 16 },
});
