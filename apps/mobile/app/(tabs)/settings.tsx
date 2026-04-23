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
  Modal,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { colors, spacing, typography } from '@/constants/theme';
import { api } from '@/lib/api';
import { TVPressable, TVTextInput } from '@/components/TVFocusable';
import { useAppStore } from '@/lib/store';
import { setStoredApiUrl, setAppConfigured, setRememberUser as saveRememberUser, setSavedUser, setAutoSkipIntro as saveAutoSkipIntro, setAutoSkipCredits as saveAutoSkipCredits, setDisableTouchSurface as saveDisableTouchSurface, setShowBecauseYouWatched as saveShowByw, setLiveTvChannels as saveLiveTvChannels } from '@/lib/storage';
import { useTVBackHandler } from '@/lib/useBackHandler';
import { isTV, isTVOS } from '@/lib/tv';
import { useQuery } from '@tanstack/react-query';

/** Visible toggle for TV — the native Switch is invisible on tvOS */
function TVToggle({ value }: { value: boolean }) {
  return (
    <View style={{
      width: 56, height: 30, borderRadius: 15,
      backgroundColor: value ? colors.primary : '#333',
      justifyContent: 'center', paddingHorizontal: 3,
    }}>
      <View style={{
        width: 24, height: 24, borderRadius: 12,
        backgroundColor: '#fff',
        alignSelf: value ? 'flex-end' : 'flex-start',
      }} />
    </View>
  );
}

interface ServiceStatus {
  connected: boolean;
  loading: boolean;
  label: string;
}

interface ServerConfigData {
  plex: { url: string; token: string; configured: boolean };
  sonarr: { url: string; apiKey: string; configured: boolean };
  radarr: { url: string; apiKey: string; configured: boolean };
  jellyfin?: { url: string; username: string; password: string; configured: boolean };
  emby?: { url: string; username: string; password: string; configured: boolean };
  epg: { provider: string; country: string; tmdbApiKey: string };
}

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const apiInputRef = useRef<TextInput>(null);
  const { apiUrl, setApiUrl, setConfigured, currentUser, setCurrentUser, rememberUser, setRememberUser, autoSkipIntro, setAutoSkipIntro, autoSkipCredits, setAutoSkipCredits, disableTouchSurface, setDisableTouchSurface, showBecauseYouWatched, setShowBecauseYouWatched, liveTvChannels, setLiveTvChannels } = useAppStore();
  const { data: availableChannels = [], isLoading: channelsLoading, error: channelsError, refetch: refetchChannels } = useQuery({
    queryKey: ['live', 'channels'],
    queryFn: () => api.getLiveChannels(),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);

  useTVBackHandler(useCallback(() => {
    apiInputRef.current?.focus();
    return true;
  }, []));
  const [localApiUrl, setLocalApiUrl] = useState(apiUrl);
  const [serverConfig, setServerConfig] = useState<ServerConfigData | null>(null);
  const [services, setServices] = useState<Record<string, ServiceStatus>>({
    plex: { connected: false, loading: false, label: 'Plex' },
    jellyfin: { connected: false, loading: false, label: 'Jellyfin' },
    emby: { connected: false, loading: false, label: 'Emby' },
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
      const [health, providers] = await Promise.all([
        api.getHealth(),
        api.getAuthProviders().catch(() => ({ plex: true, jellyfin: false, emby: false, sonarr: true, radarr: true })),
      ]);
      const svcStatus = health.services;
      setServices({
        plex: { connected: svcStatus.plex === 'connected', loading: false, label: 'Plex' },
        jellyfin: { connected: providers.jellyfin, loading: false, label: 'Jellyfin' },
        emby: { connected: providers.emby, loading: false, label: 'Emby' },
        sonarr: { connected: svcStatus.sonarr === 'connected', loading: false, label: 'Sonarr' },
        radarr: { connected: svcStatus.radarr === 'connected', loading: false, label: 'Radarr' },
      });
    } catch {
      setServices({
        plex: { connected: false, loading: false, label: 'Plex' },
        jellyfin: { connected: false, loading: false, label: 'Jellyfin' },
        emby: { connected: false, loading: false, label: 'Emby' },
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
              <TVPressable
                style={[styles.serviceRow, { borderBottomWidth: 0 }]}
                onPress={async () => {
                  const val = !rememberUser;
                  setRememberUser(val);
                  await saveRememberUser(val);
                  if (val && currentUser) {
                    await setSavedUser({ id: currentUser.id, title: currentUser.title, thumb: currentUser.thumb });
                  }
                }}
              >
                <Text style={styles.serviceLabel}>Remember login</Text>
                {isTV ? <TVToggle value={rememberUser} /> : (
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
                )}
              </TVPressable>
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

        {/* Playback */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Playback</Text>
          <TVPressable
            style={styles.serviceRow}
            onPress={async () => {
              const val = !autoSkipIntro;
              setAutoSkipIntro(val);
              await saveAutoSkipIntro(val);
            }}
          >
            <Text style={styles.serviceLabel}>Auto-skip intros</Text>
            {isTV ? <TVToggle value={autoSkipIntro} /> : (
              <Switch
                value={autoSkipIntro}
                onValueChange={async (val) => {
                  setAutoSkipIntro(val);
                  await saveAutoSkipIntro(val);
                }}
                trackColor={{ false: '#333', true: colors.primary }}
                thumbColor="#fff"
              />
            )}
          </TVPressable>
          <TVPressable
            style={[styles.serviceRow, { borderBottomWidth: 0 }]}
            onPress={async () => {
              const val = !autoSkipCredits;
              setAutoSkipCredits(val);
              await saveAutoSkipCredits(val);
            }}
          >
            <Text style={styles.serviceLabel}>Auto-skip credits</Text>
            {isTV ? <TVToggle value={autoSkipCredits} /> : (
              <Switch
                value={autoSkipCredits}
                onValueChange={async (val) => {
                  setAutoSkipCredits(val);
                  await saveAutoSkipCredits(val);
                }}
                trackColor={{ false: '#333', true: colors.primary }}
                thumbColor="#fff"
              />
            )}
          </TVPressable>
          <TVPressable
            style={styles.serviceRow}
            onPress={async () => {
              const val = !showBecauseYouWatched;
              setShowBecauseYouWatched(val);
              await saveShowByw(val);
            }}
          >
            <Text style={styles.serviceLabel}>"Because you watched" recommendations</Text>
            {isTV ? <TVToggle value={showBecauseYouWatched} /> : (
              <Switch
                value={showBecauseYouWatched}
                onValueChange={async (val) => {
                  setShowBecauseYouWatched(val);
                  await saveShowByw(val);
                }}
                trackColor={{ false: '#333', true: colors.primary }}
                thumbColor="#fff"
              />
            )}
          </TVPressable>
        </View>

        {/* What's on TV */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What's on TV</Text>
          <Text style={styles.sectionDescription}>
            Pick the channels you watch. The home screen shows what's on now and coming up later on these channels.
          </Text>
          <View style={[styles.serviceRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.serviceLabel}>
              {liveTvChannels.length === 0
                ? 'No channels selected'
                : `${liveTvChannels.length} channel${liveTvChannels.length === 1 ? '' : 's'} selected`}
            </Text>
          </View>
          <TVPressable
            style={styles.primaryButton}
            onPress={() => setChannelPickerOpen(true)}
          >
            <Text style={styles.primaryButtonText}>Configure Channels</Text>
          </TVPressable>
        </View>

        <ChannelPickerModal
          visible={channelPickerOpen}
          onClose={() => setChannelPickerOpen(false)}
          availableChannels={availableChannels}
          liveTvChannels={liveTvChannels}
          setLiveTvChannels={setLiveTvChannels}
          channelsLoading={channelsLoading}
          channelsError={channelsError as Error | null}
          refetchChannels={refetchChannels}
        />

        {/* Sports */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sports</Text>
          <Text style={styles.sectionDescription}>
            Pick leagues and favorite teams. The Sports tab shows what's on now and what's coming up next.
          </Text>
          <TVPressable
            style={styles.primaryButton}
            onPress={() => router.push('/sports-settings' as any)}
          >
            <Text style={styles.primaryButtonText}>Configure Sports Follows</Text>
          </TVPressable>
        </View>

        {/* Apple TV Remote */}
        {isTVOS && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Remote</Text>
            <TVPressable
              style={[styles.serviceRow, { borderBottomWidth: 0 }]}
              onPress={async () => {
                const val = !disableTouchSurface;
                setDisableTouchSurface(val);
                await saveDisableTouchSurface(val);
                try {
                  const { TVEventControl } = require('react-native');
                  if (val) {
                    TVEventControl?.disableTVPanGesture?.();
                  } else {
                    TVEventControl?.enableTVPanGesture?.();
                  }
                } catch {}
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.serviceLabel}>D-pad only (disable swipe)</Text>
                <Text style={[styles.sectionDescription, { marginBottom: 0, marginTop: 4 }]}>
                  Disable the touch/swipe surface on the Siri Remote
                </Text>
              </View>
              <TVToggle value={disableTouchSurface} />
            </TVPressable>
          </View>
        )}

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

        {/* Server Updates */}
        <ServerUpdatesSection />

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

            {serverConfig.jellyfin?.configured ? (
              <>
                <Text style={styles.configGroupTitle}>Jellyfin</Text>
                <ConfigRow label="URL" value={serverConfig.jellyfin.url} />
                <ConfigRow label="Username" value={serverConfig.jellyfin.username} />
              </>
            ) : null}

            {serverConfig.emby?.configured ? (
              <>
                <Text style={styles.configGroupTitle}>Emby</Text>
                <ConfigRow label="URL" value={serverConfig.emby.url} />
                <ConfigRow label="Username" value={serverConfig.emby.username} />
              </>
            ) : null}

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

function ChannelPickerModal({
  visible,
  onClose,
  availableChannels,
  liveTvChannels,
  setLiveTvChannels,
  channelsLoading,
  channelsError,
  refetchChannels,
}: {
  visible: boolean;
  onClose: () => void;
  availableChannels: string[];
  liveTvChannels: string[];
  setLiveTvChannels: (c: string[]) => void;
  channelsLoading: boolean;
  channelsError: Error | null;
  refetchChannels: () => void;
}) {
  useEffect(() => {
    if (!visible || !isTV) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

  const toggle = async (channel: string) => {
    const enabled = liveTvChannels.includes(channel);
    const next = enabled ? liveTvChannels.filter((x) => x !== channel) : [...liveTvChannels, channel];
    setLiveTvChannels(next);
    await saveLiveTvChannels(next);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={modalStyles.container}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Configure Channels</Text>
            <Text style={modalStyles.subtitle}>
              {liveTvChannels.length} of {availableChannels.length} selected
            </Text>
          </View>
          <ScrollView style={modalStyles.list} contentContainerStyle={modalStyles.listContent}>
            {channelsLoading ? (
              <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>
                Loading channels...
              </Text>
            ) : channelsError ? (
              <View>
                <Text style={[styles.sectionDescription, { color: colors.error }]}>
                  Couldn't load channels: {channelsError.message}
                </Text>
                <TVPressable
                  style={[styles.primaryButton, { backgroundColor: colors.surface, marginTop: spacing.sm }]}
                  onPress={() => refetchChannels()}
                >
                  <Text style={[styles.primaryButtonText, { color: colors.text }]}>Retry</Text>
                </TVPressable>
              </View>
            ) : availableChannels.length === 0 ? (
              <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>
                No channels available.
              </Text>
            ) : (
              availableChannels.map((channel) => {
                const enabled = liveTvChannels.includes(channel);
                return (
                  <TVPressable key={channel} style={styles.serviceRow} onPress={() => toggle(channel)}>
                    <Text style={styles.serviceLabel}>{channel}</Text>
                    {isTV ? <TVToggle value={enabled} /> : (
                      <Switch
                        value={enabled}
                        onValueChange={() => toggle(channel)}
                        trackColor={{ false: '#333', true: colors.primary }}
                        thumbColor="#fff"
                      />
                    )}
                  </TVPressable>
                );
              })
            )}
          </ScrollView>
          <TVPressable
            style={[styles.primaryButton, { margin: spacing.lg, marginTop: 0 }]}
            onPress={onClose}
            hasTVPreferredFocus={isTV}
          >
            <Text style={styles.primaryButtonText}>Done</Text>
          </TVPressable>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: colors.background,
    borderRadius: 12,
    width: '90%',
    maxWidth: 520,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  header: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  title: {
    ...typography.title,
    fontSize: 20,
  },
  subtitle: {
    ...typography.caption,
    marginTop: 4,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});

function ServerUpdatesSection() {
  const [status, setStatus] = useState<{
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    lastCheckedAt: string | null;
    lastError: string | null;
    platformSupported: boolean;
    enabled: boolean;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    api.getUpdateStatus().then(setStatus).catch(() => {});
  }, []);

  async function doCheck() {
    setChecking(true);
    try {
      const res = await api.checkForUpdate();
      const current = await api.getUpdateStatus();
      setStatus(current);
      if (res.lastError) {
        Alert.alert('Check failed', res.lastError);
      } else if (res.updateAvailable) {
        Alert.alert('Update available', `${res.currentVersion} → ${res.latestVersion}`);
      } else {
        Alert.alert('Up to date', `Running ${res.currentVersion}`);
      }
    } catch (error) {
      Alert.alert('Error', (error as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function doApply() {
    Alert.alert(
      'Install update?',
      'The server service will stop, update, and restart. The app may briefly lose connection.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Install',
          onPress: async () => {
            setApplying(true);
            try {
              await api.applyUpdate();
              Alert.alert('Update started', 'The installer is running. The server will come back online in ~30 seconds.');
            } catch (error) {
              Alert.alert('Error', (error as Error).message);
            } finally {
              setApplying(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Server Updates</Text>
      {!status ? (
        <Text style={[styles.sectionDescription, { color: colors.textMuted }]}>Loading…</Text>
      ) : !status.platformSupported ? (
        <Text style={styles.sectionDescription}>
          Auto-update is only supported on Windows servers.
        </Text>
      ) : (
        <>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Current</Text>
            <Text style={styles.configValue}>{status.currentVersion}</Text>
          </View>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Latest</Text>
            <Text style={styles.configValue}>
              {status.latestVersion
                ? status.latestVersion + (status.updateAvailable ? ' (new)' : '')
                : '—'}
            </Text>
          </View>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Last checked</Text>
            <Text style={styles.configValue}>
              {status.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleString() : 'Never'}
            </Text>
          </View>
          {status.lastError ? (
            <Text style={[styles.sectionDescription, { color: colors.error, marginTop: spacing.sm }]}>
              {status.lastError}
            </Text>
          ) : null}
          <TVPressable
            style={[styles.primaryButton, { backgroundColor: colors.surface, marginTop: spacing.md }]}
            onPress={doCheck}
          >
            <Text style={[styles.primaryButtonText, { color: colors.text }]}>
              {checking ? 'Checking…' : 'Check for Updates'}
            </Text>
          </TVPressable>
          {status.updateAvailable && (
            <TVPressable
              style={[styles.primaryButton, { marginTop: spacing.sm }]}
              onPress={doApply}
            >
              <Text style={styles.primaryButtonText}>
                {applying ? 'Starting…' : 'Install Update'}
              </Text>
            </TVPressable>
          )}
        </>
      )}
    </View>
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
    paddingVertical: isTV ? spacing.lg : spacing.md,
    borderBottomWidth: isTV ? 0 : 1, borderBottomColor: colors.cardBorder,
    ...(isTV ? { borderWidth: 2, borderColor: 'transparent', borderRadius: 8, marginBottom: spacing.xs } : {}),
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
