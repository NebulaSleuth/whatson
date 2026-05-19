import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { setStoredApiUrl, setStoredAuthKey } from '@/lib/storage';
import { colors, spacing, typography } from '@/constants/theme';

/**
 * Pairing screen — mirrors the Roku channel's pair view (apps/roku
 * components/HomeScene.brs). Shown when the backend has an admin
 * password set and we don't have an auth key locally yet.
 *
 * Flow:
 *   1. POST /api/auth/pair/start → backend mints a 6-digit code (10m TTL).
 *   2. Display the code with the URL the admin should sign into.
 *   3. Poll GET /api/auth/pair/poll every 3s. Backend returns
 *      { status:'completed', key } once the admin enters the code in
 *      /setup. Persist the key to expo-secure-store, hop to /select-user.
 *   4. If the code expires (410), auto-reissue.
 */
type ParsedUrl = { host: string; port: string; useHttps: boolean };

function parseApiUrl(url: string): ParsedUrl {
  if (!url) return { host: '192.168.', port: '3001', useHttps: false };
  try {
    const stripped = url.replace(/\/api\/?$/, '');
    const m = /^(https?):\/\/([^:/]+)(?::(\d+))?/i.exec(stripped);
    if (!m) return { host: '192.168.', port: '3001', useHttps: false };
    return {
      useHttps: m[1].toLowerCase() === 'https',
      host: m[2],
      port: m[3] || (m[1].toLowerCase() === 'https' ? '443' : '3001'),
    };
  } catch {
    return { host: '192.168.', port: '3001', useHttps: false };
  }
}

export default function PairDeviceScreen() {
  const apiUrl = useAppStore((s) => s.apiUrl);
  const setApiUrl = useAppStore((s) => s.setApiUrl);
  const setAuthKey = useAppStore((s) => s.setAuthKey);
  const initial = parseApiUrl(apiUrl);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port);
  const [useHttps, setUseHttps] = useState(initial.useHttps);
  // Caret-at-end on the host field on first focus so users typing 192.168.x.x
  // can pick up where the prefill leaves off.
  const [hostSelection, setHostSelection] = useState<{ start: number; end: number } | undefined>(
    () => ({ start: initial.host.length, end: initial.host.length }),
  );
  // First-run installs have no apiUrl set — open the URL editor immediately
  // and skip auto-pair until the user enters a server address.
  const [editingUrl, setEditingUrl] = useState(!apiUrl);
  const [code, setCode] = useState<string | null>(null);
  const [statusText, setStatusText] = useState(apiUrl ? 'Connecting…' : 'Enter your server address to continue.');
  const [busy, setBusy] = useState(false);
  const pollHandle = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeRef = useRef<string | null>(null);

  useEffect(() => {
    if (apiUrl) void requestPairCode();
    return () => {
      if (pollHandle.current) clearInterval(pollHandle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestPairCode() {
    if (busy) {
      console.log('[Pair] requestPairCode skipped: busy');
      return;
    }
    const currentUrl = useAppStore.getState().apiUrl;
    console.log(`[Pair] requestPairCode start url=${currentUrl}`);
    setBusy(true);
    setCode(null);
    codeRef.current = null;
    setStatusText('Checking server…');
    if (pollHandle.current) clearInterval(pollHandle.current);
    pollHandle.current = null;

    try {
      const adminStatus = await api.getAdminStatus();
      console.log(`[Pair] adminStatus hasAdminPassword=${adminStatus.hasAdminPassword}`);
      if (!adminStatus.hasAdminPassword) {
        setStatusText('Connected. No pairing required — continuing…');
        setTimeout(() => router.replace('/' as any), 400);
        return;
      }

      setStatusText('Requesting pair code…');
      const label = labelForDevice();
      const res = await api.pairStart(label);
      console.log(`[Pair] pairStart returned code=${res.code}`);
      setCode(res.code);
      codeRef.current = res.code;
      setStatusText('Waiting for the admin to enter this code…');
      pollHandle.current = setInterval(() => void poll(), 3000);
    } catch (e) {
      console.warn('[Pair] requestPairCode error:', (e as Error).message);
      setStatusText(`Can't reach server: ${(e as Error).message}. Check the URL below.`);
    } finally {
      setBusy(false);
    }
  }

  async function poll() {
    const c = codeRef.current;
    if (!c) return;
    try {
      const res = await api.pairPoll(c);
      if (res.status === 'expired') {
        setStatusText('Code expired — requesting a new one…');
        await requestPairCode();
        return;
      }
      if (res.status === 'completed' && res.key) {
        if (pollHandle.current) clearInterval(pollHandle.current);
        pollHandle.current = null;
        setStatusText('Paired! Continuing…');
        await setStoredAuthKey(res.key);
        setAuthKey(res.key);
        // Slight delay so the success message is readable.
        setTimeout(() => router.replace('/' as any), 400);
      }
      // Pending — leave UI as-is, next tick will re-poll.
    } catch (e) {
      // Transient errors during polling are OK; keep trying.
      console.warn('[Pair] poll error:', (e as Error).message);
    }
  }

  async function saveUrl() {
    const cleanHost = host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    const cleanPort = port.trim();
    if (!cleanHost) {
      setStatusText('Please enter the server IP or hostname.');
      return;
    }
    const portNum = Number(cleanPort);
    if (!cleanPort || !Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      setStatusText('Port must be a number between 1 and 65535.');
      return;
    }
    const scheme = useHttps ? 'https' : 'http';
    const next = `${scheme}://${cleanHost}:${cleanPort}/api`;
    if (next === apiUrl) {
      setEditingUrl(false);
      return;
    }
    await setStoredApiUrl(next);
    setApiUrl(next);
    setEditingUrl(false);
    console.log(`[Pair] saveUrl saved=${next}`);
    // Re-issue against the new URL.
    void requestPairCode();
  }

  const displayUrl = apiUrl.replace(/\/api\/?$/, '');
  const hasUrl = !!apiUrl;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.title}>{hasUrl ? 'Pair this device' : 'Connect to your server'}</Text>
        {hasUrl ? (
          <Text style={styles.subtitle}>
            Open <Text style={styles.url}>{displayUrl}/setup</Text> in a browser, sign in as admin, then enter the code below under Security & Devices → Pair a new device.
          </Text>
        ) : (
          <Text style={styles.subtitle}>
            Enter the address of your Whats On backend below. It usually looks like <Text style={styles.url}>http://192.168.x.x:3001</Text>.
          </Text>
        )}

        {hasUrl && (
          <View style={styles.codeBox}>
            {code ? (
              <Text style={styles.codeText}>{code}</Text>
            ) : (
              <ActivityIndicator size="large" color={colors.primary} />
            )}
          </View>
        )}

        <Text style={styles.status}>{statusText}</Text>

        <View style={styles.actions}>
          {hasUrl && (
            <Pressable
              onPress={() => void requestPairCode()}
              disabled={busy}
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, busy && styles.buttonDisabled]}>
              <Text style={styles.buttonText}>{busy ? 'Working…' : 'New code'}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setEditingUrl((v) => !v)}
            style={({ pressed }) => [styles.button, styles.buttonSecondary, pressed && styles.buttonPressed]}>
            <Text style={styles.buttonText}>{editingUrl ? 'Cancel' : hasUrl ? 'Edit server URL' : 'Set server URL'}</Text>
          </Pressable>
        </View>

        {editingUrl && (
          <View style={styles.urlEdit}>
            <Pressable
              onPress={() => setUseHttps((v) => !v)}
              style={({ pressed }) => [styles.checkboxRow, pressed && styles.buttonPressed]}>
              <View style={[styles.checkbox, useHttps && styles.checkboxChecked]}>
                {useHttps && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>Use HTTPS</Text>
            </Pressable>

            <View style={styles.fieldRow}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>IP / hostname</Text>
                <TextInput
                  value={host}
                  onChangeText={(v) => { setHost(v); setHostSelection(undefined); }}
                  selection={hostSelection}
                  onSelectionChange={() => setHostSelection(undefined)}
                  placeholder="192.168.1.181"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={styles.urlInput}
                />
              </View>
              <View style={styles.fieldGroupPort}>
                <Text style={styles.fieldLabel}>Port</Text>
                <TextInput
                  value={port}
                  onChangeText={setPort}
                  placeholder="3001"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={5}
                  style={styles.urlInput}
                />
              </View>
            </View>

            <Pressable
              onPress={() => void saveUrl()}
              style={({ pressed }) => [styles.button, styles.saveButton, pressed && styles.buttonPressed]}>
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.hint}>
          The code expires after 10 minutes; we'll auto-issue a new one if it does.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function labelForDevice(): string {
  const isTV = Platform.isTV === true;
  if (Platform.OS === 'ios') return isTV ? 'Apple TV (Whats On)' : 'iPhone (Whats On)';
  if (Platform.OS === 'android') return isTV ? 'Android TV (Whats On)' : 'Android phone (Whats On)';
  return `Whats On (${Platform.OS})`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, gap: spacing.lg },
  title: { ...typography.title, color: colors.primary, fontSize: 32 },
  subtitle: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
  url: { color: colors.text, fontWeight: '600' },
  codeBox: {
    alignSelf: 'flex-start',
    minWidth: 240,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  codeText: { fontSize: 48, fontWeight: '700', letterSpacing: 8, color: colors.text },
  status: { ...typography.body, color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap', marginTop: spacing.sm },
  button: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.cardBorder },
  buttonPressed: { opacity: 0.7 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.text, fontWeight: '600', fontSize: 16 },
  urlEdit: { flexDirection: 'column', gap: spacing.md, marginTop: spacing.sm },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
  checkbox: {
    width: 24, height: 24, borderRadius: 4,
    borderWidth: 2, borderColor: colors.cardBorder, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: colors.text, fontWeight: '700', fontSize: 14, lineHeight: 16 },
  checkboxLabel: { ...typography.body, color: colors.text },
  fieldRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' },
  fieldGroup: { flex: 1 },
  fieldGroupPort: { width: 120 },
  fieldLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: 4 },
  saveButton: { alignSelf: 'flex-start', minWidth: 140, alignItems: 'center' },
  urlInput: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    fontSize: 16,
  },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.lg },
});
