import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SportsLeagueSummary, SportsPrefs, SportsTeamSummary } from '@whatson/shared';
import { api } from '@/lib/api';
import { colors, spacing, typography } from '@/constants/theme';

/**
 * Local draft that lets us stage changes before PUT. Empty prefs start with
 * nothing followed; toggling a league adds an entry, tapping teams refines it.
 */
type Draft = Record<string, { following: boolean; mode: 'teams' | 'all'; teamIds: Set<string> }>;

function draftFromPrefs(prefs: SportsPrefs, leagues: SportsLeagueSummary[]): Draft {
  const byKey = new Map(prefs.leagues.map((l) => [l.key, l]));
  const draft: Draft = {};
  for (const l of leagues) {
    const entry = byKey.get(l.key);
    draft[l.key] = {
      following: !!entry,
      mode: !l.teamSport ? 'all' : entry?.mode === 'all' ? 'all' : 'teams',
      teamIds: new Set(entry?.teamIds || []),
    };
  }
  return draft;
}

function draftToPrefs(draft: Draft): SportsPrefs {
  const leagues = Object.entries(draft)
    .filter(([, v]) => v.following)
    .map(([key, v]) => ({ key, mode: v.mode, teamIds: v.mode === 'teams' ? [...v.teamIds] : [] }));
  return { leagues };
}

export default function SportsSettingsScreen() {
  const qc = useQueryClient();
  const leaguesQuery = useQuery({ queryKey: ['sports', 'leagues'], queryFn: api.getSportsLeagues });
  const prefsQuery = useQuery({ queryKey: ['sports', 'prefs'], queryFn: api.getSportsPrefs });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [pickingLeague, setPickingLeague] = useState<SportsLeagueSummary | null>(null);

  useEffect(() => {
    if (leaguesQuery.data && prefsQuery.data && !draft) {
      setDraft(draftFromPrefs(prefsQuery.data, leaguesQuery.data));
    }
  }, [leaguesQuery.data, prefsQuery.data, draft]);

  const saveMutation = useMutation({
    mutationFn: (prefs: SportsPrefs) => api.putSportsPrefs(prefs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sports'] });
      router.back();
    },
  });

  const onToggleLeague = useCallback((key: string) => {
    setDraft((d) => d && { ...d, [key]: { ...d[key], following: !d[key].following } });
  }, []);

  const onChangeMode = useCallback((key: string, mode: 'teams' | 'all') => {
    setDraft((d) => d && { ...d, [key]: { ...d[key], mode } });
  }, []);

  const onToggleTeam = useCallback((key: string, teamId: string) => {
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d[key].teamIds);
      if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
      return { ...d, [key]: { ...d[key], teamIds: next } };
    });
  }, []);

  const onSave = useCallback(() => {
    if (!draft) return;
    saveMutation.mutate(draftToPrefs(draft));
  }, [draft, saveMutation]);

  const grouped = useMemo(() => {
    const by: Record<string, SportsLeagueSummary[]> = {};
    for (const l of leaguesQuery.data || []) (by[l.sport] = by[l.sport] || []).push(l);
    return Object.entries(by).sort(([a], [b]) => a.localeCompare(b));
  }, [leaguesQuery.data]);

  if (leaguesQuery.isLoading || prefsQuery.isLoading || !draft) {
    return <SafeAreaView style={styles.container}><View style={styles.centerFill}><ActivityIndicator size="large" color={colors.primary} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBar}>
        <Pressable style={styles.hdrBtn} onPress={() => router.back()} focusable><Text style={styles.hdrBtnText}>Cancel</Text></Pressable>
        <Text style={styles.hdrTitle}>Sports Settings</Text>
        <Pressable style={[styles.hdrBtn, styles.hdrBtnPrimary]} onPress={onSave} focusable disabled={saveMutation.isPending}>
          <Text style={styles.hdrBtnTextPrimary}>{saveMutation.isPending ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {grouped.map(([sport, leagues]) => (
          <View key={sport} style={styles.group}>
            <Text style={styles.groupTitle}>{sport.toUpperCase()}</Text>
            {leagues.map((l) => {
              const entry = draft[l.key];
              return (
                <View key={l.key} style={styles.row}>
                  <Pressable style={styles.rowHead} onPress={() => onToggleLeague(l.key)} focusable>
                    <Text style={styles.rowTitle}>{l.label}</Text>
                    <View style={[styles.toggle, entry.following && styles.toggleOn]}>
                      <View style={[styles.toggleDot, entry.following && styles.toggleDotOn]} />
                    </View>
                  </Pressable>
                  {entry.following && l.teamSport && (
                    <View style={styles.modeRow}>
                      <ModeChip active={entry.mode === 'teams'} label={`Favorite teams (${entry.teamIds.size})`} onPress={() => { onChangeMode(l.key, 'teams'); setPickingLeague(l); }} />
                      <ModeChip active={entry.mode === 'all'} label="All games" onPress={() => onChangeMode(l.key, 'all')} />
                    </View>
                  )}
                  {entry.following && !l.teamSport && (
                    <Text style={styles.nonTeamNote}>Following all events (no team selection for {sport})</Text>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {pickingLeague && (
        <TeamPicker
          league={pickingLeague}
          selectedIds={draft[pickingLeague.key].teamIds}
          onToggle={(teamId) => onToggleTeam(pickingLeague.key, teamId)}
          onClose={() => setPickingLeague(null)}
        />
      )}
    </SafeAreaView>
  );
}

function ModeChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress} focusable>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function TeamPicker({ league, selectedIds, onToggle, onClose }: {
  league: SportsLeagueSummary;
  selectedIds: Set<string>;
  onToggle: (teamId: string) => void;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['sports', 'teams', league.key],
    queryFn: () => api.getSportsTeams(league.key),
  });

  const sorted = useMemo(() => [...(data || [])].sort((a, b) => a.name.localeCompare(b.name)), [data]);

  const renderItem = useCallback(({ item }: { item: SportsTeamSummary }) => {
    const selected = selectedIds.has(item.id);
    return (
      <Pressable style={[styles.teamRow, selected && styles.teamRowSelected]} onPress={() => onToggle(item.id)} focusable>
        {item.logo ? (
          <Image source={{ uri: item.logo }} style={styles.teamLogo} contentFit="contain" cachePolicy="disk" />
        ) : (
          <View style={[styles.teamLogo, { backgroundColor: '#222', borderRadius: 12 }]} />
        )}
        <Text style={styles.teamName}>{item.name}</Text>
        {selected && <Text style={styles.checkMark}>✓</Text>}
      </Pressable>
    );
  }, [selectedIds, onToggle]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.headerBar}>
          <Pressable style={styles.hdrBtn} onPress={onClose} focusable><Text style={styles.hdrBtnText}>Close</Text></Pressable>
          <Text style={styles.hdrTitle}>{league.label} teams</Text>
          <View style={styles.hdrBtn} />
        </View>
        {isLoading ? (
          <View style={styles.centerFill}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : (
          <FlatList data={sorted} keyExtractor={(t) => t.id} renderItem={renderItem} />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  hdrBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minWidth: 60 },
  hdrBtnPrimary: { backgroundColor: colors.primary, borderRadius: 6 },
  hdrBtnText: { color: colors.primary, fontWeight: '600' },
  hdrBtnTextPrimary: { color: '#000', fontWeight: '700' },
  hdrTitle: { ...typography.sectionTitle, flex: 1, textAlign: 'center' },
  group: { marginTop: spacing.md, paddingHorizontal: spacing.md },
  groupTitle: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm, letterSpacing: 1.5 },
  row: { backgroundColor: colors.surface, borderRadius: 8, marginBottom: spacing.sm, padding: spacing.md },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { ...typography.body, fontWeight: '600' },
  toggle: { width: 48, height: 28, borderRadius: 14, backgroundColor: '#333', justifyContent: 'center', padding: 2 },
  toggleOn: { backgroundColor: colors.primary },
  toggleDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignSelf: 'flex-start' },
  toggleDotOn: { alignSelf: 'flex-end' },
  modeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextActive: { color: '#000', fontWeight: '700' },
  nonTeamNote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, fontStyle: 'italic' },
  teamRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.cardBorder, gap: spacing.md },
  teamRowSelected: { backgroundColor: 'rgba(229, 160, 13, 0.15)' },
  teamLogo: { width: 32, height: 32 },
  teamName: { ...typography.body, flex: 1 },
  checkMark: { color: colors.primary, fontWeight: '700', fontSize: 22 },
});
