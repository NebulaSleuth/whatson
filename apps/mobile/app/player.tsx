import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  BackHandler,
  Modal,
  FlatList,
  TouchableWithoutFeedback,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { isTV } from '@/lib/tv';

// Import TV event handler if available
let useTVEventHandler: any = null;
try {
  useTVEventHandler = require('react-native').useTVEventHandler;
} catch {}

const BITRATE_OPTIONS = [
  { label: 'Original (Direct)', value: 0 },
  { label: '20 Mbps (1080p)', value: 20000 },
  { label: '12 Mbps (1080p)', value: 12000 },
  { label: '10 Mbps (720p)', value: 10000 },
  { label: '8 Mbps (720p)', value: 8000 },
  { label: '4 Mbps (720p)', value: 4000 },
  { label: '3 Mbps (480p)', value: 3000 },
  { label: '2 Mbps (480p)', value: 2000 },
  { label: '1.5 Mbps (360p)', value: 1500 },
];

const SEEK_STEP_SECONDS = 10; // D-pad seek step
const SCRUB_STEP_SECONDS = 30; // Progress bar scrub step

interface PlaybackInfo {
  sessionId: string;
  title: string;
  duration: number;
  viewOffset: number;
  serverUrl: string;
}

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// ── TV Controls Overlay ──
function TVControls({
  visible, playing, position, duration, title,
  onPlayPause, onSeekBack, onSeekForward, onQuality, onBack, onScrub,
}: {
  visible: boolean; playing: boolean; position: number; duration: number; title: string;
  onPlayPause: () => void; onSeekBack: () => void; onSeekForward: () => void;
  onQuality: () => void; onBack: () => void; onScrub: (deltaSeconds: number) => void;
}) {
  const [focused, setFocused] = useState<string | null>(null);

  if (!visible) return null;

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <View style={tvStyles.overlay}>
      <Text style={tvStyles.title}>{title}</Text>

      {/* Focusable progress bar */}
      <Pressable
        style={[tvStyles.progressContainer, focused === 'progress' && tvStyles.progressFocused]}
        onFocus={() => setFocused('progress')}
        onBlur={() => setFocused(null)}
        focusable={true}
        onPress={onPlayPause}
      >
        <View style={tvStyles.progressTrack}>
          <View style={[tvStyles.progressFill, { width: `${progress}%` }]} />
          {focused === 'progress' && (
            <View style={[tvStyles.progressThumb, { left: `${progress}%` }]} />
          )}
        </View>
        <View style={tvStyles.timeRow}>
          <Text style={tvStyles.time}>{formatTime(position)}</Text>
          {focused === 'progress' && (
            <Text style={tvStyles.scrubHint}>← → to scrub</Text>
          )}
          <Text style={tvStyles.time}>{formatTime(duration)}</Text>
        </View>
      </Pressable>

      <View style={tvStyles.controls}>
        <Pressable style={[tvStyles.btn, focused === 'back' && tvStyles.btnFocused]}
          onPress={onBack} onFocus={() => setFocused('back')} onBlur={() => setFocused(null)} focusable={true}>
          <MaterialIcons name="stop-circle" size={32} color="#fff" />
        </Pressable>
        <Pressable style={[tvStyles.btn, focused === 'rew' && tvStyles.btnFocused]}
          onPress={onSeekBack} onFocus={() => setFocused('rew')} onBlur={() => setFocused(null)} focusable={true}>
          <MaterialIcons name="replay-30" size={32} color="#fff" />
        </Pressable>
        <Pressable style={[tvStyles.btn, tvStyles.btnPlay, focused === 'play' && tvStyles.btnFocused]}
          onPress={onPlayPause} onFocus={() => setFocused('play')} onBlur={() => setFocused(null)}
          focusable={true} hasTVPreferredFocus={true}>
          <MaterialIcons name={playing ? 'pause-circle-filled' : 'play-circle-filled'} size={38} color="#000" />
        </Pressable>
        <Pressable style={[tvStyles.btn, focused === 'fwd' && tvStyles.btnFocused]}
          onPress={onSeekForward} onFocus={() => setFocused('fwd')} onBlur={() => setFocused(null)} focusable={true}>
          <MaterialIcons name="forward-30" size={32} color="#fff" />
        </Pressable>
        <Pressable style={[tvStyles.btn, focused === 'quality' && tvStyles.btnFocused]}
          onPress={onQuality} onFocus={() => setFocused('quality')} onBlur={() => setFocused(null)} focusable={true}>
          <MaterialIcons name="high-quality" size={32} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

// ── Main Player Screen ──
export default function PlayerScreen() {
  const { ratingKey } = useLocalSearchParams<{ ratingKey: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null);
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [selectedBitrate, setSelectedBitrate] = useState(20000);
  const [focusedBitrate, setFocusedBitrate] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPositionRef = useRef(0);
  const showControlsRef = useRef(true); // Ref mirror for TV event handler

  // expo-video player
  const player = useVideoPlayer(streamUrl || '', (p) => {
    p.play();
    setIsPlaying(true);
  });

  // Track position + detect end of playback
  useEffect(() => {
    if (!player) return;
    const interval = setInterval(() => {
      try {
        const currentMs = Math.floor((player.currentTime || 0) * 1000);
        currentPositionRef.current = currentMs;

        // Auto-close when video ends (within 2 seconds of duration)
        if (playbackInfo && playbackInfo.duration > 0 && currentMs > 0) {
          if (currentMs >= playbackInfo.duration - 2000) {
            handleBack();
          }
        }
      } catch {}
    }, 1000);
    return () => clearInterval(interval);
  }, [player, playbackInfo]);

  // Keep ref in sync with state for TV event handler
  useEffect(() => {
    showControlsRef.current = showControls;
  }, [showControls]);

  // TV D-pad event handler — seek with left/right when controls are hidden
  if (isTV && useTVEventHandler) {
    useTVEventHandler((evt: any) => {
      if (showControlsRef.current || showSettings) return; // Controls visible — let normal focus work

      if (evt.eventType === 'right') {
        try { player.currentTime = Math.max(0, (player.currentTime || 0) + SEEK_STEP_SECONDS); } catch {}
      } else if (evt.eventType === 'left') {
        try { player.currentTime = Math.max(0, (player.currentTime || 0) - SEEK_STEP_SECONDS); } catch {}
      } else if (evt.eventType === 'select' || evt.eventType === 'playPause') {
        // Show controls on select
        resetControlsTimer();
      }
    });
  }

  // Auto-hide controls
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => setShowControls(false), 5000);
  }, []);

  const handleScreenPress = useCallback(() => {
    if (showControls) {
      setShowControls(false);
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    } else {
      resetControlsTimer();
    }
  }, [showControls, resetControlsTimer]);

  // Load playback
  useEffect(() => {
    if (!ratingKey) return;
    let cancelled = false;

    async function startPlayback() {
      try {
        setLoading(true);
        setError(null);
        const info = await api.getPlaybackInfo(ratingKey);
        if (cancelled) return;

        setPlaybackInfo({
          sessionId: info.sessionId, title: info.title, duration: info.duration,
          viewOffset: info.viewOffset, serverUrl: info.serverUrl,
        });

        let url = info.streamUrl;
        if (info.viewOffset > 0) {
          const offsetSec = Math.floor(info.viewOffset / 1000);
          url = url.replace(/offset=\d+/, `offset=${offsetSec}`);
          currentPositionRef.current = info.viewOffset;
        }

        setStreamUrl(url);
        setLoading(false);
        resetControlsTimer();

        progressInterval.current = setInterval(async () => {
          await api.reportProgress(ratingKey, currentPositionRef.current, info.duration, 'playing', info.sessionId).catch(() => {});
        }, 10000);
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); setLoading(false); }
      }
    }

    startPlayback();
    return () => { cancelled = true; if (progressInterval.current) clearInterval(progressInterval.current); };
  }, [ratingKey, resetControlsTimer]);

  // Back / close player
  const handleBack = useCallback(async () => {
    if (showSettings) { setShowSettings(false); return; }
    try { player.pause(); } catch {}
    if (playbackInfo) {
      await api.reportProgress(ratingKey!, currentPositionRef.current, playbackInfo.duration, 'stopped', playbackInfo.sessionId).catch(() => {});
      await api.stopPlayback(playbackInfo.sessionId).catch(() => {});
    }
    if (progressInterval.current) clearInterval(progressInterval.current);
    router.back();
  }, [ratingKey, playbackInfo, showSettings, player]);

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => { handleBack(); return true; });
    return () => handler.remove();
  }, [handleBack]);

  // Play/Pause
  const handlePlayPause = useCallback(() => {
    resetControlsTimer();
    try {
      if (isPlaying) {
        player.pause();
        setIsPlaying(false);
      } else {
        player.play();
        setIsPlaying(true);
      }
    } catch (e) {
      console.error('[Player] Play/pause error:', e);
    }
  }, [isPlaying, resetControlsTimer, player]);

  // Seek
  const handleSeek = useCallback((deltaSeconds: number) => {
    resetControlsTimer();
    try {
      const newTime = Math.max(0, (player.currentTime || 0) + deltaSeconds);
      player.currentTime = newTime;
    } catch (e) {
      console.error('[Player] Seek error:', e);
    }
  }, [resetControlsTimer, player]);

  // Scrub from progress bar (larger steps)
  const handleScrub = useCallback((deltaSeconds: number) => {
    try {
      const newTime = Math.max(0, (player.currentTime || 0) + deltaSeconds);
      player.currentTime = newTime;
    } catch {}
  }, [player]);

  // Bitrate change
  const handleBitrateChange = useCallback(async (bitrate: number) => {
    if (!playbackInfo || !ratingKey) return;
    setSelectedBitrate(bitrate);
    setShowSettings(false);
    resetControlsTimer();

    const currentTime = player.currentTime || 0;
    player.pause();

    await api.stopPlayback(playbackInfo.sessionId).catch(() => {});
    const newInfo = await api.getPlaybackInfo(ratingKey, currentPositionRef.current);
    const resolution = bitrate <= 2000 ? '720x480' : bitrate <= 4000 ? '1280x720' : '1920x1080';
    const newUrl = newInfo.streamUrl
      .replace(/maxVideoBitrate=\d+/, `maxVideoBitrate=${bitrate === 0 ? '200000' : bitrate}`)
      .replace(/videoResolution=[^&]+/, `videoResolution=${resolution}`)
      .replace(/directPlay=\d/, `directPlay=${bitrate === 0 ? '1' : '0'}`);

    setPlaybackInfo((prev) => prev ? { ...prev, sessionId: newInfo.sessionId } : prev);
    setStreamUrl(newUrl);

    setTimeout(() => {
      try {
        player.currentTime = currentTime;
        player.play();
        setIsPlaying(true);
      } catch {}
    }, 1000);
  }, [playbackInfo, ratingKey, resetControlsTimer, player]);

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Playback Error</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.backButton} onPress={() => router.back()} focusable={true}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={handleScreenPress}>
      <View style={styles.container}>
        <View style={styles.videoContainer} pointerEvents="none">
          <VideoView
            player={player}
            style={styles.video}
            allowsFullscreen={false}
            allowsPictureInPicture={!isTV}
            nativeControls={false}
          />
        </View>

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading {playbackInfo?.title || ''}...</Text>
          </View>
        )}

        {/* Controls overlay */}
        {!loading && (
          <TVControls
            visible={showControls}
            playing={isPlaying}
            position={currentPositionRef.current}
            duration={playbackInfo?.duration || 0}
            title={playbackInfo?.title || ''}
            onPlayPause={handlePlayPause}
            onSeekBack={() => handleSeek(-30)}
            onSeekForward={() => handleSeek(30)}
            onQuality={() => { setShowSettings(true); if (!isTV) setShowControls(true); }}
            onBack={handleBack}
            onScrub={handleScrub}
          />
        )}

        {/* Bitrate picker */}
        <Modal visible={showSettings} transparent animationType="fade" onRequestClose={() => setShowSettings(false)}>
          <Pressable style={styles.settingsOverlay} onPress={() => setShowSettings(false)}>
            <Pressable style={styles.settingsPanel} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.settingsTitle}>Video Quality</Text>
              <FlatList
                data={BITRATE_OPTIONS}
                keyExtractor={(item) => String(item.value)}
                renderItem={({ item, index }) => (
                  <Pressable
                    style={[styles.bitrateOption, selectedBitrate === item.value && styles.bitrateSelected,
                      isTV && focusedBitrate === item.value && styles.bitrateFocused]}
                    onPress={() => handleBitrateChange(item.value)}
                    onFocus={() => setFocusedBitrate(item.value)}
                    onBlur={() => setFocusedBitrate(null)}
                    focusable={true} hasTVPreferredFocus={index === 0}>
                    <Text style={[styles.bitrateText, selectedBitrate === item.value && styles.bitrateTextSelected]}>
                      {item.label}
                    </Text>
                    {selectedBitrate === item.value && <Text style={styles.bitrateCheck}>✓</Text>}
                  </Pressable>
                )}
              />
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </TouchableWithoutFeedback>
  );
}

const tvStyles = StyleSheet.create({
  overlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)', padding: spacing.lg, paddingBottom: spacing.xl,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: spacing.md },
  progressContainer: {
    marginBottom: spacing.md, borderWidth: 2, borderColor: 'transparent',
    borderRadius: 4, padding: spacing.xs,
  },
  progressFocused: { borderColor: colors.focus },
  progressTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, position: 'relative' },
  progressFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  progressThumb: {
    position: 'absolute', top: -6, width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.primary, marginLeft: -8,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  time: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
  scrubHint: { color: colors.primary, fontSize: 10, fontWeight: '600' },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
  btn: {
    padding: spacing.sm, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  btnFocused: { borderColor: colors.focus, backgroundColor: 'rgba(255,255,255,0.25)' },
  btnPlay: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 26 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  videoContainer: { flex: 1 },
  video: { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)' },
  loadingText: { color: colors.text, fontSize: 16, marginTop: spacing.lg },
  errorContainer: { padding: spacing.xl, alignItems: 'center' },
  errorTitle: { color: colors.error, fontSize: 20, fontWeight: '700', marginBottom: spacing.md },
  errorText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: spacing.xl },
  backButton: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 8 },
  backButtonText: { color: '#000', fontSize: 16, fontWeight: '600' },
  settingsOverlay: { flex: 1, justifyContent: 'center', alignItems: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)', paddingRight: isTV ? 60 : 20 },
  settingsPanel: { backgroundColor: '#1A1A1A', borderRadius: 12, padding: spacing.lg, width: isTV ? 350 : 280, maxHeight: '80%' },
  settingsTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: spacing.lg },
  bitrateOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: 6, marginBottom: spacing.xs, borderWidth: 1, borderColor: 'transparent' },
  bitrateSelected: { backgroundColor: 'rgba(229, 160, 13, 0.15)' },
  bitrateFocused: { borderColor: colors.focus },
  bitrateText: { color: colors.textSecondary, fontSize: 15 },
  bitrateTextSelected: { color: colors.primary, fontWeight: '600' },
  bitrateCheck: { color: colors.primary, fontSize: 18, fontWeight: '700' },
});
