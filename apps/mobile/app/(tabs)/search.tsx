import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
  Image as RNImage,
  TextInput,
} from 'react-native';
// expo-image not used on discover cards due to Android TV rendering issues
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TVPressable, TVTextInput } from '@/components/TVFocusable';
import { isTV } from '@/lib/tv';
import { useTVBackHandler } from '@/lib/useBackHandler';
import { getSonarrPrefs, setSonarrPrefs, getRadarrPrefs, setRadarrPrefs } from '@/lib/storage';
import type { ContentItem } from '@whatson/shared';
import { STREAMING_PROVIDERS } from '@whatson/shared';
import type { StreamingProvider } from '@whatson/shared';
import { ContentCard } from '@/components/ContentCard';
import { DetailSheet } from '@/components/DetailSheet';
import { api, resolveArtworkUrl } from '@/lib/api';
import { colors, spacing, typography, cardDimensions } from '@/constants/theme';

type SearchMode = 'library' | 'discover';
type FilterType = 'all' | 'tv' | 'movie';

export default function SearchScreen() {
  const queryClient = useQueryClient();
  const searchInputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('library');

  useTVBackHandler(useCallback(() => {
    searchInputRef.current?.focus();
    return true;
  }, []));
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [trackingItem, setTrackingItem] = useState<any | null>(null);

  const debouncedQuery = useDebounce(query, 400);

  // Library search
  const { data: libraryData, isLoading: libraryLoading, refetch: refetchLibrary } = useQuery({
    queryKey: ['search', 'library', debouncedQuery, filter],
    queryFn: () => api.search(debouncedQuery, filter === 'all' ? undefined : filter),
    enabled: mode === 'library' && debouncedQuery.length >= 2,
  });

  // TMDB discover search
  const { data: discoverData, isLoading: discoverLoading } = useQuery({
    queryKey: ['search', 'discover', debouncedQuery],
    queryFn: () => api.discoverSearch(debouncedQuery),
    enabled: mode === 'discover' && debouncedQuery.length >= 2,
  });

  const handleItemPress = useCallback((item: ContentItem) => {
    setSelectedItem(item);
  }, []);

  const [actionItem, setActionItem] = useState<any | null>(null);
  const [showArrPicker, setShowArrPicker] = useState<'sonarr' | 'radarr' | null>(null);

  const handleDiscoverSelect = useCallback((item: any) => {
    if (item.isTracked) return;
    setActionItem(item);

    if (item.type === 'tv') {
      Alert.alert(item.title, 'What would you like to do?', [
        {
          text: 'Track (Live TV)',
          onPress: () => { setActionItem(item); setTrackingItem(item); },
        },
        {
          text: 'Add to Sonarr',
          onPress: () => { setActionItem(item); setShowArrPicker('sonarr'); },
        },
        { text: 'Cancel', style: 'cancel', onPress: () => setActionItem(null) },
      ]);
    } else if (item.type === 'movie') {
      Alert.alert(item.title, 'Add this movie to Radarr for download?', [
        {
          text: 'Add to Radarr',
          onPress: () => { setActionItem(item); setShowArrPicker('radarr'); },
        },
        { text: 'Cancel', style: 'cancel', onPress: () => setActionItem(null) },
      ]);
    }
  }, []);

  const handleTrack = useCallback((item: any) => {
    setTrackingItem(item);
  }, []);

  async function confirmTrack(provider: StreamingProvider) {
    if (!trackingItem) return;
    try {
      await api.addTracked({
        tmdbId: trackingItem.tmdbId,
        imdbId: trackingItem.imdbId,
        title: trackingItem.title,
        type: trackingItem.type,
        year: trackingItem.year,
        overview: trackingItem.overview,
        poster: trackingItem.poster,
        backdrop: trackingItem.backdrop,
        rating: trackingItem.rating,
        provider,
      });
      queryClient.invalidateQueries({ queryKey: ['search', 'discover'] });
      queryClient.invalidateQueries({ queryKey: ['tracked'] });
      Alert.alert('Added', `${trackingItem.title} added to your watchlist`);
    } catch (error) {
      Alert.alert('Error', (error as Error).message);
    }
    setTrackingItem(null);
    setActionItem(null);
  }

  const isLoading = mode === 'library' ? libraryLoading : discoverLoading;
  const libraryResults = libraryData?.results || [];
  const discoverResults = discoverData || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TVTextInput
          inputRef={searchInputRef}
          style={styles.searchInput}
          placeholder={mode === 'library' ? 'Search your library...' : 'Search to discover & track...'}
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType={isTV ? 'done' : 'search'}
        />
      </View>

      {/* Mode Toggle */}
      <View style={styles.modeRow}>
        <TVPressable
          style={[styles.modeChip, mode === 'library' && styles.modeChipActive]}
          onPress={() => setMode('library')}
        >
          <Text style={[styles.modeText, mode === 'library' && styles.modeTextActive]}>My Library</Text>
        </TVPressable>
        <TVPressable
          style={[styles.modeChip, mode === 'discover' && styles.modeChipActive]}
          onPress={() => setMode('discover')}
        >
          <Text style={[styles.modeText, mode === 'discover' && styles.modeTextActive]}>Discover & Track</Text>
        </TVPressable>
      </View>

      {/* Filter Chips (library mode only) */}
      {mode === 'library' && (
        <View style={styles.filterRow}>
          {(['all', 'tv', 'movie'] as FilterType[]).map((f) => (
            <TVPressable
              key={f}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f === 'all' ? 'All' : f === 'tv' ? 'TV Shows' : 'Movies'}
              </Text>
            </TVPressable>
          ))}
        </View>
      )}

      {/* Results */}
      {isLoading && debouncedQuery.length >= 2 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : mode === 'library' ? (
        <FlatList
          key="library-grid"
          data={libraryResults}
          numColumns={3}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.gridItem}>
              <ContentCard item={item} onPress={handleItemPress} onMarkWatched={() => refetchLibrary()} />
            </View>
          )}
          contentContainerStyle={styles.resultsList}
          removeClippedSubviews={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {debouncedQuery.length >= 2 ? 'No results found' : 'Type to search your library'}
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          key="discover-list"
          data={discoverResults}
          keyExtractor={(item: any) => String(item.tmdbId)}
          renderItem={({ item }: { item: any }) => (
            <DiscoverCard item={item} onTrack={handleDiscoverSelect} />
          )}
          contentContainerStyle={styles.resultsList}
          removeClippedSubviews={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {debouncedQuery.length >= 2 ? 'No results found' : 'Search to find shows & movies to track'}
              </Text>
            </View>
          }
        />
      )}

      {selectedItem && (
        <DetailSheet
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onRefresh={() => refetchLibrary()}
        />
      )}

      {/* Provider Picker Modal */}
      <ProviderPicker
        visible={trackingItem !== null}
        title={trackingItem?.title || ''}
        onSelect={confirmTrack}
        onClose={() => { setTrackingItem(null); setActionItem(null); }}
      />

      {/* Sonarr/Radarr Add Picker Modal */}
      <ArrAddPicker
        visible={showArrPicker !== null}
        type={showArrPicker || 'sonarr'}
        item={actionItem}
        onClose={() => { setShowArrPicker(null); setActionItem(null); }}
        onSuccess={() => {
          setShowArrPicker(null);
          setActionItem(null);
          queryClient.invalidateQueries();
        }}
      />
    </SafeAreaView>
  );
}

const DiscoverCard = React.memo(function DiscoverCard({ item, onTrack }: { item: any; onTrack: (item: any) => void }) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      style={styles.discoverCard}
      onPress={() => !item.isTracked && onTrack(item)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      focusable={true}
    >
      <RNImage
        source={{ uri: item.poster }}
        style={styles.discoverPoster}
        resizeMode="cover"
      />
      <View style={styles.discoverInfo}>
        <Text style={styles.discoverTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.discoverMeta}>
          {item.type === 'tv' ? 'TV Show' : 'Movie'} {item.year > 0 ? `· ${item.year}` : ''} {item.rating > 0 ? `· ${item.rating.toFixed(1)}` : ''}
        </Text>
        <Text style={styles.discoverOverview} numberOfLines={3}>{item.overview}</Text>
        {item.type === 'tv' ? (
          item.isTracked ? (
            <View style={styles.trackedBadge}>
              <Text style={styles.trackedBadgeText}>Tracked</Text>
            </View>
          ) : (
            <View style={styles.addButton}>
              <Text style={styles.addButtonText}>+ Track</Text>
            </View>
          )
        ) : (
          <View style={styles.addButton}>
            <Text style={styles.addButtonText}>+ Radarr</Text>
          </View>
        )}
      </View>
      {isTV && focused && <View style={styles.discoverFocusBorder} />}
    </Pressable>
  );
});

function ProviderPicker({
  visible,
  title,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  onSelect: (provider: StreamingProvider) => void;
  onClose: () => void;
}) {
  const providers: StreamingProvider[] = [
    'netflix', 'disney_plus', 'hulu', 'amazon_prime', 'max',
    'apple_tv_plus', 'paramount_plus', 'peacock', 'youtube_tv',
    'sling_tv', 'fubo_tv', 'directv', 'philo',
    'amc_plus', 'starz', 'showtime', 'mubi',
    'crunchyroll', 'britbox', 'bet_plus',
    'tubi', 'pluto_tv', 'roku_channel', 'freevee', 'crackle',
    'plex', 'sonarr', 'radarr', 'other',
  ];

  const [focusedProvider, setFocusedProvider] = useState<string | null>(null);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.modalSheet}>
          {!isTV && <View style={styles.modalHandle} />}
          <Text style={styles.modalTitle}>Where do you watch?</Text>
          <Text style={styles.modalSubtitle}>{title}</Text>
          <FlatList
            data={providers}
            keyExtractor={(p) => p}
            numColumns={isTV ? 4 : 2}
            key={isTV ? 'tv-4col' : 'mobile-2col'}
            removeClippedSubviews={false}
            renderItem={({ item: p, index }) => (
              <Pressable
                style={[
                  styles.providerButton,
                  isTV && focusedProvider === p && styles.providerButtonFocused,
                ]}
                onPress={() => onSelect(p)}
                onFocus={() => setFocusedProvider(p)}
                onBlur={() => setFocusedProvider(null)}
                focusable={true}
                hasTVPreferredFocus={index === 0}
              >
                <Text style={styles.providerText}>{STREAMING_PROVIDERS[p]}</Text>
              </Pressable>
            )}
            contentContainerStyle={styles.providerList}
          />
        </View>
      </View>
    </Modal>
  );
}

function FocusOption({
  label,
  selected,
  onPress,
  preferFocus,
  style: customStyle,
  textStyle: customTextStyle,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  preferFocus?: boolean;
  style?: any;
  textStyle?: any;
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
        customStyle || arrStyles.option,
        selected && arrStyles.optionSelected,
        isTV && focused && arrStyles.optionFocused,
      ]}
    >
      <Text style={[
        customTextStyle || arrStyles.optionText,
        selected && arrStyles.optionTextSelected,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ArrAddPicker({
  visible,
  type,
  item,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  type: 'sonarr' | 'radarr';
  item: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [profiles, setProfiles] = useState<Array<{ id: number; name: string }>>([]);
  const [folders, setFolders] = useState<Array<{ id: number; path: string }>>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [monitor, setMonitor] = useState<'all' | 'future'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
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

        // Restore saved preferences, or fall back to first option
        if (prefs.profileId && p.some((x: any) => x.id === prefs.profileId)) {
          setSelectedProfile(prefs.profileId);
        } else if (p.length > 0) {
          setSelectedProfile(p[0].id);
        }

        if (prefs.folderPath && f.some((x: any) => x.path === prefs.folderPath)) {
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
      } else {
        await api.addToRadarr({
          title: item.title,
          tmdbId: item.tmdbId,
          qualityProfileId: selectedProfile,
          rootFolderPath: selectedFolder,
        });
      }
      // Save preferences for next time
      if (type === 'sonarr') {
        setSonarrPrefs(selectedProfile, selectedFolder, monitor);
      } else {
        setRadarrPrefs(selectedProfile, selectedFolder);
      }

      Alert.alert('Added', `${item.title} added to ${type === 'sonarr' ? 'Sonarr' : 'Radarr'}`);
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  const isSonarr = type === 'sonarr';
  const pickerTitle = item?.title || '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.modalOverlay, { justifyContent: 'center' }]}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={arrStyles.sheet}>
          {!isTV && <View style={styles.modalHandle} />}
          <Text style={styles.modalTitle}>Add to {isSonarr ? 'Sonarr' : 'Radarr'}</Text>
          <Text style={styles.modalSubtitle}>{pickerTitle}</Text>

          {error && <Text style={arrStyles.error}>{error}</Text>}

          <View style={arrStyles.section}>
            <Text style={arrStyles.label}>Quality Profile</Text>
            <View style={arrStyles.optionRow}>
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

          <View style={arrStyles.section}>
            <Text style={arrStyles.label}>Root Folder</Text>
            <View style={arrStyles.optionRow}>
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
            <View style={arrStyles.section}>
              <Text style={arrStyles.label}>Monitor</Text>
              <View style={arrStyles.optionRow}>
                <FocusOption label="All Episodes" selected={monitor === 'all'} onPress={() => setMonitor('all')} />
                <FocusOption label="Future Only" selected={monitor === 'future'} onPress={() => setMonitor('future')} />
              </View>
            </View>
          )}

          <View style={arrStyles.actions}>
            <FocusOption
              label={loading ? 'Adding...' : `Add to ${isSonarr ? 'Sonarr' : 'Radarr'}`}
              selected={false}
              onPress={handleAdd}
              style={arrStyles.addBtn}
              textStyle={arrStyles.addBtnText}
            />
            <FocusOption
              label="Cancel"
              selected={false}
              onPress={onClose}
              style={arrStyles.cancelBtn}
              textStyle={arrStyles.cancelBtnText}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const arrStyles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginHorizontal: isTV ? 120 : 20,
    paddingVertical: spacing.lg,
    maxHeight: '80%',
  },
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
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { fontSize: 16, fontWeight: '600', color: '#000' },
  cancelBtn: {
    flex: 1, backgroundColor: colors.cardBorder, paddingVertical: spacing.md,
    borderRadius: 8, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 16, fontWeight: '600', color: colors.text },
  error: { color: colors.error, paddingHorizontal: spacing.lg, marginBottom: spacing.md, fontSize: 13 },
});

function useDebounce(value: string, delay: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  headerTitle: { ...typography.title },
  searchContainer: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  searchInput: {
    backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, fontSize: 16, color: colors.text,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  modeRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.md },
  modeChip: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: 20, alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.cardBorder,
  },
  modeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  modeTextActive: { color: '#000' },
  filterRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.lg },
  filterChip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 20,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.cardBorder,
  },
  filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  filterTextActive: { color: '#000' },
  resultsList: { paddingHorizontal: spacing.lg },
  gridItem: { width: cardDimensions.poster.width, marginBottom: spacing.lg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyContainer: { paddingTop: 60, alignItems: 'center' },
  emptyText: { ...typography.body },
  // Discover cards
  discoverCard: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 8,
    marginBottom: spacing.md, overflow: 'hidden',
  },
  discoverPoster: { width: 80, height: 120 },
  discoverInfo: { flex: 1, padding: spacing.md },
  discoverTitle: { ...typography.cardTitle, fontSize: 16, marginBottom: 4 },
  discoverMeta: { ...typography.caption, marginBottom: spacing.sm },
  discoverOverview: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 16 },
  trackedBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.success, paddingHorizontal: spacing.md,
    paddingVertical: 3, borderRadius: 4,
  },
  trackedBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  addButton: {
    alignSelf: 'flex-start', backgroundColor: colors.primary, paddingHorizontal: spacing.md,
    paddingVertical: 4, borderRadius: 4,
  },
  addButtonText: { fontSize: 12, fontWeight: '700', color: '#000' },
  movieBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.cardBorder, paddingHorizontal: spacing.md,
    paddingVertical: 3, borderRadius: 4,
  },
  movieBadgeText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  discoverFocusBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: colors.focus,
    borderRadius: 8,
  },
  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: spacing.md, paddingBottom: spacing.xxl, maxHeight: '60%',
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', alignSelf: 'center', marginBottom: spacing.lg },
  modalTitle: { ...typography.sectionTitle, paddingHorizontal: spacing.lg, marginBottom: 4 },
  modalSubtitle: { ...typography.body, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  providerList: { paddingHorizontal: spacing.md },
  providerButton: {
    flex: 1, margin: spacing.xs, backgroundColor: colors.card, paddingVertical: spacing.md,
    borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder,
  },
  providerText: { ...typography.cardTitle, fontSize: 13 },
  providerButtonFocused: {
    borderColor: colors.focus,
    borderWidth: 2,
    backgroundColor: colors.surfaceHover,
  },
});
