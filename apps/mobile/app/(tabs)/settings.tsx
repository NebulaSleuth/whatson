import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Switch,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { colors, spacing, typography } from '@/constants/theme';
import { api } from '@/lib/api';
import { TVPressable, TVTextInput } from '@/components/TVFocusable';
import { useAppStore } from '@/lib/store';
import { setStoredApiUrl, setAppConfigured, setRememberUser as saveRememberUser, setSavedUser } from '@/lib/storage';
import { useTVBackHandler } from '@/lib/useBackHandler';

interface ServiceStatus {
  connected: boolean;
  loading: boolean;
  label: string;
}

interface ServerConfigData {
  plex: { url: string; token: string; configured: boolean };
  sonarr: { url: string; apiKey: string; configured: boolean };
  radarr: { url: string; apiKey: string; configured: boolean };
  epg: { provider: string; country: string; tmdbApiKey: string };
}

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const apiInputRef = useRef<TextInput>(null);
  const { apiUrl, setApiUrl, setConfigured, currentUser, setCurrentUser, rememberUser, setRememberUser } = useAppStore();

  useTVBackHandler(useCallback(() => {
    apiInputRef.current?.focus();
    return true;
  }, []));
  const [localApiUrl, setLocalApiUrl] = useState(apiUrl);
  const [serverConfig, setServerConfig] = useState<ServerConfigData | null>(null);
  const [services, setServices] = useState<Record<string, ServiceStatus>>({
    plex: { connected: false, loading: false, label: 'Plex' },
    sonarr: { connected: false, loading: false, label: 'Sonarr' },
    radarr: { connected: false, loading: false, label: 'Radarr' },
  });
  const [checkingHealth, setCheckingHealth] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    await Promise.all([checkHealth(), loadConfig()]);
  }

  async function loadConfig() {
    try {
      const data = await api.getConfig();
      setServerConfig(data as ServerConfigData);
    } catch {}
  }

  async function checkHealth() {
    setCheckingHealth(true);
    try {
      const health = await api.getHealth();
      const svcStatus = health.services;
      setServices({
        plex: { connected: svcStatus.plex === 'connected', loading: false, label: 'Plex' },
        sonarr: { connected: svcStatus.sonarr === 'connected', loading: false, label: 'Sonarr' },
        radarr: { connected: svcStatus.radarr === 'connected', loading: false, label: 'Radarr' },
      });
    } catch {
      setServices({
        plex: { connected: false, loading: false, label: 'Plex' },
        sonarr: { connected: false, loading: false, label: 'Sonarr' },
        radarr: { connected: false, loading: false, label: 'Radarr' },
      });
    }
    setCheckingHealth(false);
  }

  async function saveApiUrl() {
    const trimmed = localApiUrl.replace(/\/+$/, '');
    setApiUrl(trimmed);
    await setStoredApiUrl(trimmed);
    await setAppConfigured(true);
    setConfigured(true);
    queryClient.invalidateQueries();
    Alert.alert('Saved', 'API URL updated. Checking connections...');
    loadAll();
  }

  function statusColor(svc: ServiceStatus): string {
    if (svc.loading) return colors.textMuted;
    return svc.connected ? colors.success : colors.error;
  }

  function statusText(svc: ServiceStatus): string {
    if (svc.loading) return 'Checking...';
    return svc.connected ? 'Connected' : 'Not connected';
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
        </View>

        {/* API URL */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Backend API</Text>
          <Text style={styles.sectionDescription}>
            URL of your Whats On backend server.
          </Text>
          <TVTextInput
            inputRef={apiInputRef}
            style={styles.input}
            value={localApiUrl}
            onChangeText={setLocalApiUrl}
            placeholder="http://192.168.1.100:3001/api"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TVPressable style={styles.primaryButton} onPress={saveApiUrl}>
            <Text style={styles.primaryButtonText}>Save & Test</Text>
          </TVPressable>
        </View>

        {/* User */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>User</Text>
          {currentUser ? (
            <>
              <View style={styles.serviceRow}>
                <View style={styles.serviceInfo}>
                  <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
                  <Text style={styles.serviceLabel}>Signed in as {currentUser.title}</Text>
                </View>
              </View>
              <View style={[styles.serviceRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.serviceLabel}>Remember login</Text>
                <Switch
                  value={rememberUser}
                  onValueChange={async (val) => {
                    setRememberUser(val);
                    await saveRememberUser(val);
                    if (val && currentUser) {
                      await setSavedUser({ id: currentUser.id, title: currentUser.title, thumb: currentUser.thumb });
                    }
                  }}
                  trackColor={{ false: '#333', true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
              <TVPressable
                style={[styles.primaryButton, { backgroundColor: colors.surface, marginTop: spacing.md }]}
                onPress={() => {
                  setCurrentUser(null);
                  setSavedUser(null);
                  queryClient.clear();
                  router.replace('/select-user' as any);
                }}
              >
                <Text style={[styles.primaryButtonText, { color: colors.text }]}>Switch User</Text>
              </TVPressable>
            </>
          ) : (
            <TVPressable
              style={styles.primaryButton}
              onPress={() => router.replace('/select-user' as any)}
            >
              <Text style={styles.primaryButtonText}>Select User</Text>
            </TVPressable>
          )}
        </View>

        {/* Service Status */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Service Status</Text>
            {checkingHealth ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <TVPressable onPress={loadAll}>
                <Text style={styles.refreshText}>Refresh</Text>
              </TVPressable>
            )}
          </View>

          {Object.entries(services).map(([key, svc]) => (
            <View key={key} style={styles.serviceRow}>
              <View style={styles.serviceInfo}>
                <View style={[styles.statusDot, { backgroundColor: statusColor(svc) }]} />
                <Text style={styles.serviceLabel}>{svc.label}</Text>
              </View>
              <Text style={[styles.serviceStatus, { color: statusColor(svc) }]}>
                {statusText(svc)}
              </Text>
            </View>
          ))}
        </View>

        {/* Server Configuration */}
        {serverConfig && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Server Configuration</Text>
            <Text style={styles.sectionDescription}>
              These settings are configured in the backend .env file.
            </Text>

            <Text style={styles.configGroupTitle}>Plex</Text>
            <ConfigRow label="URL" value={serverConfig.plex.url} />
            <ConfigRow label="Token" value={serverConfig.plex.token} masked />

            <Text style={styles.configGroupTitle}>Sonarr</Text>
            <ConfigRow label="URL" value={serverConfig.sonarr.url} />
            <ConfigRow label="API Key" value={serverConfig.sonarr.apiKey} masked />

            <Text style={styles.configGroupTitle}>Radarr</Text>
            <ConfigRow label="URL" value={serverConfig.radarr.url} />
            <ConfigRow label="API Key" value={serverConfig.radarr.apiKey} masked />

            <Text style={styles.configGroupTitle}>EPG / Discovery</Text>
            <ConfigRow label="Provider" value={serverConfig.epg.provider} />
            <ConfigRow label="Country" value={serverConfig.epg.country} />
            <ConfigRow label="TMDB Key" value={serverConfig.epg.tmdbApiKey} masked />
          </View>
        )}

        {/* Setup Guide */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Setup Guide</Text>
          <HelpStep n={1} text="Run the Whats On backend on your network" />
          <HelpStep n={2} text="Configure Plex token, Sonarr & Radarr API keys in the backend .env file" />
          <HelpStep n={3} text="Enter the backend API URL above (e.g., http://your-server:3001/api)" />
          <HelpStep n={4} text="All services should show Connected above" />
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <ConfigRow label="App" value="Whats On v0.1.0" />
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ConfigRow({ label, value, masked }: { label: string; value: string; masked?: boolean }) {
  const display = !value ? '—' : value;
  return (
    <View style={styles.configRow}>
      <Text style={styles.configLabel}>{label}</Text>
      <Text style={[styles.configValue, !value && styles.configEmpty]}>{display}</Text>
    </View>
  );
}

function HelpStep({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.helpItem}>
      <Text style={styles.helpStep}>{n}.</Text>
      <Text style={styles.helpText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  headerTitle: { ...typography.title },
  section: { paddingHorizontal: spacing.lg, marginBottom: spacing.xxl },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  sectionTitle: { ...typography.sectionTitle, marginBottom: spacing.sm },
  sectionDescription: { ...typography.body, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, fontSize: 16, color: colors.text,
    borderWidth: 1, borderColor: colors.cardBorder, marginBottom: spacing.md,
  },
  primaryButton: { backgroundColor: colors.primary, paddingVertical: spacing.md, borderRadius: 8, alignItems: 'center' },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#000' },
  refreshText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  serviceRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
  },
  serviceInfo: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.md },
  serviceLabel: { ...typography.body, color: colors.text, fontSize: 16 },
  serviceStatus: { fontSize: 14, fontWeight: '500' },
  configGroupTitle: { ...typography.cardTitle, color: colors.primary, marginTop: spacing.lg, marginBottom: spacing.sm },
  configRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
  },
  configLabel: { ...typography.body, color: colors.textSecondary, flex: 1 },
  configValue: { ...typography.body, color: colors.text, flex: 2, textAlign: 'right' },
  configEmpty: { color: colors.textMuted, fontStyle: 'italic' },
  helpItem: { flexDirection: 'row', marginBottom: spacing.md },
  helpStep: { color: colors.primary, fontWeight: '700', fontSize: 16, marginRight: spacing.md, width: 24 },
  helpText: { ...typography.body, flex: 1, lineHeight: 22 },
  bottomSpacer: { height: 40 },
});
