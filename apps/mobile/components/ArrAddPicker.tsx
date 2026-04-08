import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Modal } from 'react-native';
import { api } from '@/lib/api';
import { getSonarrPrefs, setSonarrPrefs, getRadarrPrefs, setRadarrPrefs } from '@/lib/storage';
import { isTV } from '@/lib/tv';
import { colors, spacing, typography } from '@/constants/theme';

interface ArrAddPickerProps {
  visible: boolean;
  type: 'sonarr' | 'radarr';
  item: { title: string; tmdbId: number } | null;
  onClose: () => void;
  onSuccess: () => void;
}

function FocusOption({
  label, selected, onPress, preferFocus, style: customStyle, textStyle: customTextStyle,
}: {
  label: string; selected: boolean; onPress: () => void;
  preferFocus?: boolean; style?: any; textStyle?: any;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      focusable={true}
      hasTVPreferredFocus={preferFocus}
      style={[
        customStyle || styles.option,
        selected && styles.optionSelected,
        isTV && focused && styles.optionFocused,
      ]}
    >
      <Text style={[
        customTextStyle || styles.optionText,
        selected && styles.optionTextSelected,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ArrAddPicker({ visible, type, item, onClose, onSuccess }: ArrAddPickerProps) {
  const [profiles, setProfiles] = useState<Array<{ id: number; name: string }>>([]);
  const [folders, setFolders] = useState<Array<{ id: number; path: string }>>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [monitor, setMonitor] = useState<'all' | 'future'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setLoading(false);

    const loadConfig = async () => {
      try {
        const [p, f, prefs] = await Promise.all([
          type === 'sonarr' ? api.getSonarrProfiles() : api.getRadarrProfiles(),
          type === 'sonarr' ? api.getSonarrRootFolders() : api.getRadarrRootFolders(),
          type === 'sonarr' ? getSonarrPrefs() : getRadarrPrefs(),
        ]);
        setProfiles(p);
        setFolders(f);

        if (prefs.profileId && p.some((x) => x.id === prefs.profileId)) {
          setSelectedProfile(prefs.profileId);
        } else if (p.length > 0) {
          setSelectedProfile(p[0].id);
        }

        if (prefs.folderPath && f.some((x) => x.path === prefs.folderPath)) {
          setSelectedFolder(prefs.folderPath);
        } else if (f.length > 0) {
          setSelectedFolder(f[0].path);
        }

        if (type === 'sonarr' && prefs.monitor) {
          setMonitor(prefs.monitor as 'all' | 'future');
        }
      } catch (e) {
        setError((e as Error).message);
      }
    };
    loadConfig();
  }, [visible, type]);

  const handleAdd = async () => {
    if (!selectedProfile || !selectedFolder || !item) return;
    setLoading(true);
    setError(null);

    try {
      if (type === 'sonarr') {
        await api.addToSonarr({
          title: item.title,
          tmdbId: item.tmdbId,
          qualityProfileId: selectedProfile,
          rootFolderPath: selectedFolder,
          monitor,
          searchForMissing: true,
        });
        setSonarrPrefs(selectedProfile, selectedFolder, monitor);
      } else {
        await api.addToRadarr({
          title: item.title,
          tmdbId: item.tmdbId,
          qualityProfileId: selectedProfile,
          rootFolderPath: selectedFolder,
        });
        setRadarrPrefs(selectedProfile, selectedFolder);
      }

      Alert.alert('Added', `"${item.title}" added to ${type === 'sonarr' ? 'Sonarr' : 'Radarr'}`);
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  const isSonarr = type === 'sonarr';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>Add to {isSonarr ? 'Sonarr' : 'Radarr'}</Text>
          <Text style={styles.subtitle}>{item?.title || ''}</Text>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.section}>
            <Text style={styles.label}>Quality Profile</Text>
            <View style={styles.optionRow}>
              {profiles.map((p, i) => (
                <FocusOption
                  key={p.id}
                  label={p.name}
                  selected={selectedProfile === p.id}
                  onPress={() => setSelectedProfile(p.id)}
                  preferFocus={i === 0}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Root Folder</Text>
            <View style={styles.optionRow}>
              {folders.map((f) => (
                <FocusOption
                  key={f.id}
                  label={f.path}
                  selected={selectedFolder === f.path}
                  onPress={() => setSelectedFolder(f.path)}
                />
              ))}
            </View>
          </View>

          {isSonarr && (
            <View style={styles.section}>
              <Text style={styles.label}>Monitor</Text>
              <View style={styles.optionRow}>
                <FocusOption label="All Episodes" selected={monitor === 'all'} onPress={() => setMonitor('all')} />
                <FocusOption label="Future Only" selected={monitor === 'future'} onPress={() => setMonitor('future')} />
              </View>
            </View>
          )}

          <View style={styles.actions}>
            <FocusOption
              label={loading ? 'Adding...' : `Add to ${isSonarr ? 'Sonarr' : 'Radarr'}`}
              selected={false}
              onPress={handleAdd}
              style={styles.addBtn}
              textStyle={styles.addBtnText}
            />
            <FocusOption
              label="Cancel"
              selected={false}
              onPress={onClose}
              style={styles.cancelBtn}
              textStyle={styles.cancelBtnText}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    width: isTV ? '60%' : '90%',
    maxWidth: 600,
    paddingVertical: spacing.lg,
    maxHeight: '80%',
  },
  title: { ...typography.sectionTitle, paddingHorizontal: spacing.lg, marginBottom: 4 },
  subtitle: { ...typography.body, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg, paddingHorizontal: spacing.lg },
  label: { ...typography.cardTitle, marginBottom: spacing.sm },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 6,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
  },
  optionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionFocused: { borderColor: colors.focus, borderWidth: 2 },
  optionText: { ...typography.caption, color: colors.textSecondary },
  optionTextSelected: { color: '#000', fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  addBtn: {
    flex: 1, backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: 8, alignItems: 'center',
  },
  addBtnText: { fontSize: 16, fontWeight: '600', color: '#000' },
  cancelBtn: {
    flex: 1, backgroundColor: colors.cardBorder, paddingVertical: spacing.md,
    borderRadius: 8, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 16, fontWeight: '600', color: colors.text },
  error: { color: colors.error, paddingHorizontal: spacing.lg, marginBottom: spacing.md, fontSize: 13 },
});
