import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  BackHandler,
  Dimensions,
  Modal,
  FlatList,
  TouchableWithoutFeedback,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { colors, spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { isTV } from '@/lib/tv';

let ExpoVideoView: any = null;
let useVideoPlayerHook: any = null;
let ExpoAVVideo: any = null;
let ResizeModeEnum: any = null;

try {
  const expoVideo = require('expo-video');
  ExpoVideoView = expoVideo.VideoView;
  useVideoPlayerHook = expoVideo.useVideoPlayer;
} catch {}

if (!ExpoVideoView) {
  try {
    const expoAV = require('expo-av');
    ExpoAVVideo = expoAV.Video;
    ResizeModeEnum = expoAV.ResizeMode;
  } catch {}
}

const isNativePlayer = !!ExpoVideoView;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

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

interface PlaybackInfo {
  sessionId: string;
  title: string;
  duration: number;
  viewOffset: number;
  serverUrl: string;
}

// ── expo-video Player ──
function NativeVideoPlayer({
  streamUrl, viewOffset, onPositionChange,
}: { streamUrl: string; viewOffset: number; onPositionChange: (ms: number) => void }) {
  const playerRef = useRef<any>(null);
  const player = useVideoPlayerHook(streamUrl, (p: any) => { playerRef.current = p; });

  useEffect(() => {
    if (viewOffset > 0) {
      setTimeout(() => { try { player.currentTime = viewOffset / 1000; } catch {} }, 1000);
    }
    player.play();
    const interval = setInterval(() => {
      if (playerRef.current) onPositionChange(Math.floor((playerRef.current.currentTime || 0) * 1000));
    }, 2000);
    return () => clearInterval(interval);
  }, [player, viewOffset, onPositionChange]);

  return (
    <ExpoVideoView player={player} style={styles.video} allowsFullscreen={true}
      allowsPictureInPicture={!isTV} nativeControls={!isTV} />
  );
}

// ── expo-av Player ──
function AVVideoPlayer({
  streamUrl, viewOffset, onPositionChange, videoRef,
}: { streamUrl: string; viewOffset: number; onPositionChange: (ms: number) => void; videoRef: React.RefObject<any> }) {
  const onStatus = useCallback((status: any) => {
    if (status.isLoaded) onPositionChange(status.positionMillis || 0);
  }, [onPositionChange]);

  return (
    <ExpoAVVideo ref={videoRef} source={{ uri: streamUrl }} style={styles.video}
      resizeMode={ResizeModeEnum?.CONTAIN || 'contain'} shouldPlay={true}
      useNativeControls={!isTV} positionMillis={viewOffset}
      onPlaybackStatusUpdate={onStatus} />
  );
}

// ── TV Controls Overlay ──
function TVControls({
  visible, playing, position, duration, title,
  onPlayPause, onSeekBack, onSeekForward, onQuality, onBack,
}: {
  visible: boolean; playing: boolean; position: number; duration: number; title: string;
  onPlayPause: () => void; onSeekBack: () => void; onSeekForward: () => void;
  onQuality: () => void; onBack: () => void;
}) {
  const [focused, setFocused] = useState<string | null>(null);

  if (!visible) return null;

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <View style={tvStyles.overlay}>
      <Text style={tvStyles.title}>{title}</Text>

      <View style={tvStyles.progressContainer}>
        <View style={tvStyles.progressTrack}>
          <View style={[tvStyles.progressFill, { width: `${progress}%` }]} />
        </View>
        <View style={tvStyles.timeRow}>
          <Text style={tvStyles.time}>{formatTime(position)}</Text>
          <Text style={tvStyles.time}>{formatTime(duration)}</Text>
        </View>
      </View>

      <View style={tvStyles.controls}>
        <Pressable style={[tvStyles.btn, focused === 'back' && tvStyles.btnFocused]}
          onPress={onBack} onFocus={() => setFocused('back')} onBlur={() => setFocused(null)} focusable={true}>
          <Text style={tvStyles.btnText}>Exit</Text>
        </Pressable>
        <Pressable style={[tvStyles.btn, focused === 'rew' && tvStyles.btnFocused]}
          onPress={onSeekBack} onFocus={() => setFocused('rew')} onBlur={() => setFocused(null)} focusable={true}>
          <Text style={tvStyles.btnText}>-30s</Text>
        </Pressable>
        <Pressable style={[tvStyles.btn, tvStyles.btnPlay, focused === 'play' && tvStyles.btnFocused]}
          onPress={onPlayPause} onFocus={() => setFocused('play')} onBlur={() => setFocused(null)}
          focusable={true} hasTVPreferredFocus={true}>
          <Text style={tvStyles.btnPlayText}>{playing ? 'Pause' : 'Play'}</Text>
        </Pressable>
        <Pressable style={[tvStyles.btn, focused === 'fwd' && tvStyles.btnFocused]}
          onPress={onSeekForward} onFocus={() => setFocused('fwd')} onBlur={() => setFocused(null)} focusable={true}>
          <Text style={tvStyles.btnText}>+30s</Text>
        </Pressable>
        <Pressable style={[tvStyles.btn, focused === 'quality' && tvStyles.btnFocused]}
          onPress={onQuality} onFocus={() => setFocused('quality')} onBlur={() => setFocused(null)} focusable={true}>
          <Text style={tvStyles.btnText}>Quality</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Main Player Screen ──
export default function PlayerScreen() {
  const { ratingKey } = useLocalSearchParams<{ ratingKey: string }>();
  const videoRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedBitrate, setSelectedBitrate] = useState(20000);
  const [focusedBitrate, setFocusedBitrate] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPositionRef = useRef(0);

  const handlePositionChange = useCallback((ms: number) => {
    currentPositionRef.current = ms;
  }, []);

  // Auto-hide controls on TV
  const resetControlsTimer = useCallback(() => {
    if (!isTV) return;
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => setShowControls(false), 5000);
  }, []);

  // Show controls on any interaction
  const handleScreenPress = useCallback(() => {
    if (isTV) {
      resetControlsTimer();
    } else {
      setShowControls((v) => !v);
    }
  }, [resetControlsTimer]);

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
        setStreamUrl(info.streamUrl);
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

  // Back
  const handleBack = useCallback(async () => {
    if (showSettings) { setShowSettings(false); return; }
    if (playbackInfo) {
      await api.reportProgress(ratingKey!, currentPositionRef.current, playbackInfo.duration, 'stopped', playbackInfo.sessionId).catch(() => {});
      await api.stopPlayback(playbackInfo.sessionId).catch(() => {});
    }
    if (progressInterval.current) clearInterval(progressInterval.current);
    router.back();
  }, [ratingKey, playbackInfo, showSettings]);

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => { handleBack(); return true; });
    return () => handler.remove();
  }, [handleBack]);

  // TV play/pause
  const handlePlayPause = useCallback(async () => {
    resetControlsTimer();
    if (videoRef.current) {
      if (isPlaying) {
        await videoRef.current.pauseAsync?.();
      } else {
        await videoRef.current.playAsync?.();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying, resetControlsTimer]);

  // TV seek
  const handleSeek = useCallback(async (deltaMs: number) => {
    resetControlsTimer();
    if (videoRef.current) {
      const newPos = Math.max(0, currentPositionRef.current + deltaMs);
      await videoRef.current.setPositionAsync?.(newPos);
    }
  }, [resetControlsTimer]);

  // Bitrate change
  const handleBitrateChange = useCallback(async (bitrate: number) => {
    if (!playbackInfo || !ratingKey) return;
    setSelectedBitrate(bitrate);
    setShowSettings(false);
    resetControlsTimer();

    await api.stopPlayback(playbackInfo.sessionId).catch(() => {});
    const newInfo = await api.getPlaybackInfo(ratingKey, currentPositionRef.current);
    const resolution = bitrate <= 2000 ? '720x480' : bitrate <= 4000 ? '1280x720' : '1920x1080';
    const newUrl = newInfo.streamUrl
      .replace(/maxVideoBitrate=\d+/, `maxVideoBitrate=${bitrate === 0 ? '200000' : bitrate}`)
      .replace(/videoResolution=[^&]+/, `videoResolution=${resolution}`)
      .replace(/directPlay=\d/, `directPlay=${bitrate === 0 ? '1' : '0'}`);

    setPlaybackInfo((prev) => prev ? { ...prev, sessionId: newInfo.sessionId } : prev);
    setStreamUrl(newUrl);
  }, [playbackInfo, ratingKey, resetControlsTimer]);

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
    <View style={styles.container}>
      <TouchableWithoutFeedback onPress={handleScreenPress}>
        <View style={styles.videoContainer}>
          {streamUrl && (
            isNativePlayer ? (
              <NativeVideoPlayer key={streamUrl} streamUrl={streamUrl}
                viewOffset={playbackInfo?.viewOffset || 0} onPositionChange={handlePositionChange} />
            ) : ExpoAVVideo ? (
              <AVVideoPlayer key={streamUrl} streamUrl={streamUrl} videoRef={videoRef}
                viewOffset={playbackInfo?.viewOffset || 0} onPositionChange={handlePositionChange} />
            ) : (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>No video player available</Text>
              </View>
            )
          )}
        </View>
      </TouchableWithoutFeedback>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading {playbackInfo?.title || ''}...</Text>
        </View>
      )}

      {/* TV: custom controls overlay */}
      {isTV && !loading && (
        <TVControls
          visible={showControls}
          playing={isPlaying}
          position={currentPositionRef.current}
          duration={playbackInfo?.duration || 0}
          title={playbackInfo?.title || ''}
          onPlayPause={handlePlayPause}
          onSeekBack={() => handleSeek(-30000)}
          onSeekForward={() => handleSeek(30000)}
          onQuality={() => { setShowSettings(true); resetControlsTimer(); }}
          onBack={handleBack}
        />
      )}

      {/* Mobile: quality button (visible when controls shown) */}
      {!isTV && !loading && showControls && (
        <Pressable style={styles.settingsButton} onPress={() => setShowSettings(true)}>
          <Text style={styles.settingsButtonText}>Quality</Text>
        </Pressable>
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
  );
}

const tvStyles = StyleSheet.create({
  overlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)', padding: spacing.xl, paddingBottom: spacing.xxl,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: spacing.lg },
  progressContainer: { marginBottom: spacing.lg },
  progressTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  time: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  btn: {
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 2, borderColor: 'transparent',
  },
  btnFocused: { borderColor: colors.focus, backgroundColor: 'rgba(255,255,255,0.2)' },
  btnPlay: { backgroundColor: colors.primary, paddingHorizontal: spacing.xxl },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnPlayText: { color: '#000', fontSize: 16, fontWeight: '700' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  videoContainer: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  video: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)' },
  loadingText: { color: colors.text, fontSize: 16, marginTop: spacing.lg },
  errorContainer: { padding: spacing.xl, alignItems: 'center' },
  errorTitle: { color: colors.error, fontSize: 20, fontWeight: '700', marginBottom: spacing.md },
  errorText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: spacing.xl },
  backButton: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 8 },
  backButtonText: { color: '#000', fontSize: 16, fontWeight: '600' },
  settingsButton: { position: 'absolute', top: 50, right: 16, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  settingsButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  settingsOverlay: { flex: 1, justifyContent: 'center', alignItems: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)', paddingRight: isTV ? 60 : 20 },
  settingsPanel: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.lg, width: isTV ? 350 : 280, maxHeight: '80%' },
  settingsTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: spacing.lg },
  bitrateOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: 6, marginBottom: spacing.xs, borderWidth: 1, borderColor: 'transparent' },
  bitrateSelected: { backgroundColor: 'rgba(229, 160, 13, 0.15)' },
  bitrateFocused: { borderColor: colors.focus },
  bitrateText: { color: colors.textSecondary, fontSize: 15 },
  bitrateTextSelected: { color: colors.primary, fontWeight: '600' },
  bitrateCheck: { color: colors.primary, fontSize: 18, fontWeight: '700' },
});
