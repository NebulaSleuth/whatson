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
  findNodeHandle,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { isTV } from '@/lib/tv';
import { suppressRealtimeUpdates } from '@/lib/useRealtimeUpdates';

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

interface TrackInfo {
  id: number;
  index: number;
  language: string;
  title: string;
  selected: boolean;
}

interface MarkerInfo {
  type: 'intro' | 'credits';
  startMs: number;
  endMs: number;
}

interface PlaybackInfo {
  sessionId: string;
  title: string;
  duration: number;
  viewOffset: number;
  serverUrl: string;
  subtitles: TrackInfo[];
  audioTracks: TrackInfo[];
  markers: MarkerInfo[];
}

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// ── Seek Indicator (shown when seeking with controls hidden) ──
function SeekIndicator({ direction, seconds }: { direction: 'forward' | 'rewind' | null; seconds: number }) {
  if (!direction) return null;
  return (
    <View style={tvStyles.seekIndicator}>
      <MaterialIcons
        name={direction === 'forward' ? 'fast-forward' : 'fast-rewind'}
        size={48}
        color="#fff"
      />
      <Text style={tvStyles.seekText}>{seconds}s</Text>
    </View>
  );
}

// ── TV Controls Overlay ──
function TVControls({
  visible, playing, displayPosition, duration, title,
  onPlayPause, onSeekBack, onSeekForward, onQuality, onSubtitles, onAudio, onBack,
  onInteraction, onProgressFocusChange,
  hasSubtitles, hasAudioTracks,
  activeMarker, onSkipMarker,
}: {
  visible: boolean; playing: boolean; displayPosition: number; duration: number; title: string;
  onPlayPause: () => void; onSeekBack: () => void; onSeekForward: () => void;
  onQuality: () => void; onSubtitles: () => void; onAudio: () => void; onBack: () => void;
  onInteraction: () => void; onProgressFocusChange?: (focused: boolean) => void;
  hasSubtitles: boolean; hasAudioTracks: boolean;
  activeMarker: { type: 'intro' | 'credits'; startMs: number; endMs: number } | null;
  onSkipMarker: () => void;
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const pressableRef = useRef<any>(null);
  const [selfNodeId, setSelfNodeId] = useState<number | undefined>(undefined);

  const handleProgressRef = useCallback((ref: any) => {
    pressableRef.current = ref;
    if (ref) {
      const nodeId = findNodeHandle(ref);
      if (nodeId) setSelfNodeId(nodeId);
    }
  }, []);

  // Any focus change resets the controls timer
  const handleFocus = useCallback((name: string) => {
    setFocused(name);
    onInteraction();
    if (name === 'progress') onProgressFocusChange?.(true);
  }, [onInteraction, onProgressFocusChange]);

  const handleBlur = useCallback((name: string) => {
    setFocused((prev) => prev === name ? null : prev);
    if (name === 'progress') onProgressFocusChange?.(false);
  }, [onProgressFocusChange]);

  if (!visible) return null;

  const progress = duration > 0 ? (displayPosition / duration) * 100 : 0;

  return (
    <View style={tvStyles.overlay}>
      <Text style={tvStyles.title}>{title}</Text>

      {/* Focusable progress bar — left/right scrubs when focused */}
      <Pressable
        ref={handleProgressRef}
        style={tvStyles.progressContainer}
        onFocus={() => handleFocus('progress')}
        onBlur={() => handleBlur('progress')}
        focusable={true}
        onPress={onPlayPause}
        {...(selfNodeId ? { nextFocusLeft: selfNodeId, nextFocusRight: selfNodeId } : {})}
      >
        <View style={tvStyles.progressTrack}>
          <View style={[tvStyles.progressFill, { width: `${Math.min(progress, 100)}%` }]} />
          {focused === 'progress' && (
            <View style={[tvStyles.progressThumb, { left: `${Math.min(progress, 100)}%` }]} />
          )}
        </View>
        <View style={tvStyles.timeRow}>
          <Text style={tvStyles.time}>{formatTime(displayPosition)}</Text>
          <Text style={tvStyles.time}>{formatTime(duration)}</Text>
        </View>
      </Pressable>

      <View style={tvStyles.controls}>
        {/* Left side */}
        <View style={[tvStyles.controlsSide, { justifyContent: 'flex-end' }]}>
          {hasAudioTracks && (
            <Pressable style={[tvStyles.btn, focused === 'audio' && tvStyles.btnFocused]}
              onPress={() => { onInteraction(); onAudio(); }} onFocus={() => handleFocus('audio')} onBlur={() => handleBlur('audio')} focusable={true}>
              <MaterialIcons name="audiotrack" size={32} color="#fff" />
            </Pressable>
          )}
          <Pressable style={[tvStyles.btn, focused === 'back' && tvStyles.btnFocused]}
            onPress={() => { onInteraction(); onBack(); }} onFocus={() => handleFocus('back')} onBlur={() => handleBlur('back')} focusable={true}>
            <MaterialIcons name="stop-circle" size={32} color="#fff" />
          </Pressable>
          <Pressable style={[tvStyles.btn, focused === 'rew' && tvStyles.btnFocused]}
            onPress={() => { onInteraction(); onSeekBack(); }} onFocus={() => handleFocus('rew')} onBlur={() => handleBlur('rew')} focusable={true}>
            <MaterialIcons name="replay-30" size={32} color="#fff" />
          </Pressable>
        </View>

        {/* Center — play/pause always centered */}
        <Pressable style={[tvStyles.btn, tvStyles.btnPlay, focused === 'play' && tvStyles.btnFocused]}
          onPress={() => { onInteraction(); onPlayPause(); }} onFocus={() => handleFocus('play')} onBlur={() => handleBlur('play')}
          focusable={true} hasTVPreferredFocus={!activeMarker}>
          <MaterialIcons name={playing ? 'pause-circle-filled' : 'play-circle-filled'} size={38} color="#000" />
        </Pressable>

        {/* Right side */}
        <View style={tvStyles.controlsSide}>
          <Pressable style={[tvStyles.btn, focused === 'fwd' && tvStyles.btnFocused]}
            onPress={() => { onInteraction(); onSeekForward(); }} onFocus={() => handleFocus('fwd')} onBlur={() => handleBlur('fwd')} focusable={true}>
            <MaterialIcons name="forward-30" size={32} color="#fff" />
          </Pressable>
          <Pressable style={[tvStyles.btn, focused === 'quality' && tvStyles.btnFocused]}
            onPress={() => { onInteraction(); onQuality(); }} onFocus={() => handleFocus('quality')} onBlur={() => handleBlur('quality')} focusable={true}>
            <MaterialIcons name="high-quality" size={32} color="#fff" />
          </Pressable>
          {hasSubtitles && (
            <Pressable style={[tvStyles.btn, focused === 'subs' && tvStyles.btnFocused]}
              onPress={() => { onInteraction(); onSubtitles(); }} onFocus={() => handleFocus('subs')} onBlur={() => handleBlur('subs')} focusable={true}>
              <MaterialIcons name="subtitles" size={32} color="#fff" />
            </Pressable>
          )}
          {activeMarker && (
            <Pressable
              style={[tvStyles.btnSkip, focused === 'skip' && tvStyles.btnSkipFocused]}
              onPress={onSkipMarker}
              onFocus={() => handleFocus('skip')}
              onBlur={() => handleBlur('skip')}
              focusable={true}
              hasTVPreferredFocus={true}
            >
              <Text style={tvStyles.btnSkipText}>
                {activeMarker.type === 'intro' ? 'Skip Intro' : 'Skip Credits'}
              </Text>
              <MaterialIcons name="skip-next" size={20} color="#000" />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// ── Video Player wrapper — remounts on key change to get a fresh player ──
const VideoPlayerView = React.memo(function VideoPlayerView({ url, resumePosition, onPlayer, onPlaying }: {
  url: string;
  resumePosition: number;
  onPlayer: (p: any) => void;
  onPlaying: () => void;
}) {
  const onPlayerRef = useRef(onPlayer);
  const onPlayingRef = useRef(onPlaying);
  onPlayerRef.current = onPlayer;
  onPlayingRef.current = onPlaying;

  const p = useVideoPlayer(url || '', (player) => {
    console.log('[VideoPlayerView] setup: url=' + (url || '').slice(0, 60) + '... resume=' + resumePosition);
    if (resumePosition > 0) {
      player.currentTime = resumePosition / 1000;
    }
    player.play();
  });

  useEffect(() => {
    onPlayerRef.current(p);
    onPlayingRef.current();
  }, [p]);

  return (
    <VideoView
      player={p}
      style={styles.video}
      nativeControls={false}
    />
  );
});

// ── Main Player Screen ──
export default function PlayerScreen() {
  const { ratingKey, source: sourceParam } = useLocalSearchParams<{ ratingKey: string; source?: string }>();
  const source = sourceParam || 'plex';

  // Suppress WebSocket updates while playing — prevents stale data overwriting play position
  useEffect(() => {
    suppressRealtimeUpdates(true);
    return () => { suppressRealtimeUpdates(false); };
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | null>(null);
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [playerKey, setPlayerKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMode, setSettingsMode] = useState<'quality' | 'subtitles' | 'audio'>('quality');
  const [selectedBitrate, setSelectedBitrate] = useState(20000);
  const [focusedBitrate, setFocusedBitrate] = useState<number | null>(null);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<number | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(null);
  const [activeMarker, setActiveMarker] = useState<MarkerInfo | null>(null);
  const skippedMarkers = useRef(new Set<string>());
  const autoSkipIntro = useAppStore((s) => s.autoSkipIntro);
  const autoSkipCredits = useAppStore((s) => s.autoSkipCredits);
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progressBarFocused, setProgressBarFocused] = useState(false);
  const [displayPosition, setDisplayPosition] = useState(0); // For UI updates
  const [seekDirection, setSeekDirection] = useState<'forward' | 'rewind' | null>(null);
  const [seekAmount, setSeekAmount] = useState(0);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekIndicatorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPositionRef = useRef(0);
  const showControlsRef = useRef(true);
  const progressBarFocusedRef = useRef(false);
  const resetControlsTimerRef = useRef<() => void>(() => {});

  // Player lives in a separate component so playerKey can force full remount
  const player = useRef<any>(null);
  const handlePlayerReady = useCallback((p: any) => { player.current = p; }, []);
  const handlePlayingState = useCallback(() => setIsPlaying(true), []);

  // Track position + detect end of playback
  useEffect(() => {
    if (!player.current) return;
    const interval = setInterval(() => {
      try {
        const currentMs = Math.floor((player.current?.currentTime || 0) * 1000);
        currentPositionRef.current = currentMs;
        setDisplayPosition(currentMs);

        // Auto-close when video ends (within 2 seconds of duration)
        if (playbackInfo && playbackInfo.duration > 0 && currentMs > 0) {
          if (currentMs >= playbackInfo.duration - 2000) {
            exitPlayer();
            return;
          }
        }

        // Marker detection (intro/credits)
        if (playbackInfo?.markers?.length) {
          const marker = playbackInfo.markers.find(
            (m) => currentMs >= m.startMs && currentMs < m.endMs,
          );
          const markerKey = marker ? `${marker.type}-${marker.startMs}` : null;

          if (marker && markerKey && !skippedMarkers.current.has(markerKey)) {
            // Auto-skip if enabled
            if ((marker.type === 'intro' && autoSkipIntro) || (marker.type === 'credits' && autoSkipCredits)) {
              skippedMarkers.current.add(markerKey);
              if (player.current) {
                player.current.currentTime = marker.endMs / 1000;
                currentPositionRef.current = marker.endMs;
                setDisplayPosition(marker.endMs);
              }
              setActiveMarker(null);
            } else {
              setActiveMarker(marker);
            }
          } else if (!marker) {
            setActiveMarker(null);
          }
        }
      } catch {}
    }, 1000);
    return () => clearInterval(interval);
  }, [player, playbackInfo]);

  // Keep refs in sync with state for TV event handler
  useEffect(() => {
    showControlsRef.current = showControls;
  }, [showControls]);

  useEffect(() => {
    progressBarFocusedRef.current = progressBarFocused;
  }, [progressBarFocused]);

  // Show seek indicator briefly
  const showSeekIndicator = useCallback((direction: 'forward' | 'rewind', amount: number) => {
    setSeekDirection(direction);
    setSeekAmount(amount);
    if (seekIndicatorTimeout.current) clearTimeout(seekIndicatorTimeout.current);
    seekIndicatorTimeout.current = setTimeout(() => {
      setSeekDirection(null);
      setSeekAmount(0);
    }, 800);
  }, []);

  // Seek and update display position immediately
  const doSeek = useCallback((deltaSeconds: number) => {
    try {
      const newTime = Math.max(0, (player.current?.currentTime || 0) + deltaSeconds);
      if (player.current) player.current.currentTime = newTime;
      const newMs = Math.floor(newTime * 1000);
      currentPositionRef.current = newMs;
      setDisplayPosition(newMs);
      showSeekIndicator(deltaSeconds > 0 ? 'forward' : 'rewind', Math.abs(deltaSeconds));
      // Only reset controls timer if controls are already showing
      if (showControlsRef.current) {
        resetControlsTimerRef.current();
      }
    } catch {}
  }, [player, showSeekIndicator]);

  // Keep refs for TV event handler (avoids stale closure)
  const doSeekRef = useRef(doSeek);
  doSeekRef.current = doSeek;
  const showSettingsRef = useRef(showSettings);
  showSettingsRef.current = showSettings;

  // TV D-pad event handler
  if (isTV && useTVEventHandler) {
    useTVEventHandler((evt: any) => {
      console.log('[Player] TV event:', evt.eventType);
      if (showSettingsRef.current) return;

      // When progress bar is focused, left/right scrubs
      if (progressBarFocusedRef.current && showControlsRef.current) {
        if (evt.eventType === 'right' || evt.eventType === 'longRight') {
          doSeekRef.current(SCRUB_STEP_SECONDS);
          return;
        } else if (evt.eventType === 'left' || evt.eventType === 'longLeft') {
          doSeekRef.current(-SCRUB_STEP_SECONDS);
          return;
        }
      }

      // When controls are hidden
      if (!showControlsRef.current) {
        if (evt.eventType === 'right' || evt.eventType === 'longRight') {
          doSeekRef.current(SEEK_STEP_SECONDS);
        } else if (evt.eventType === 'left' || evt.eventType === 'longLeft') {
          doSeekRef.current(-SEEK_STEP_SECONDS);
        } else if (evt.eventType === 'down' || evt.eventType === 'up' || evt.eventType === 'select') {
          resetControlsTimerRef.current();
        }
      }
    });
  }

  // Auto-hide controls
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => setShowControls(false), 5000);
  }, []);

  // Keep ref in sync so doSeek and TV event handler can call it
  resetControlsTimerRef.current = resetControlsTimer;

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
        const info = await api.getPlaybackInfo(ratingKey, { source });
        if (cancelled) return;

        setPlaybackInfo({
          sessionId: info.sessionId, title: info.title, duration: info.duration,
          viewOffset: info.viewOffset, serverUrl: info.serverUrl,
          subtitles: info.subtitles || [], audioTracks: info.audioTracks || [],
          markers: info.markers || [],
        });

        // Set initial selections from Plex defaults
        const defaultSub = info.subtitles?.find((s: TrackInfo) => s.selected);
        if (defaultSub) setSelectedSubtitleId(defaultSub.id);
        const defaultAudio = info.audioTracks?.find((a: TrackInfo) => a.selected);
        if (defaultAudio) setSelectedAudioId(defaultAudio.id);

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
          await api.reportProgress(ratingKey, currentPositionRef.current, info.duration, 'playing', info.sessionId, source).catch(() => {});
        }, 10000);
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); setLoading(false); }
      }
    }

    startPlayback();
    return () => { cancelled = true; if (progressInterval.current) clearInterval(progressInterval.current); };
  }, [ratingKey, resetControlsTimer]);

  // Exit player — always exits, used by auto-close on video end
  const exitPlayer = useCallback(async () => {
    try { player.current?.pause(); } catch {}
    if (playbackInfo) {
      await api.reportProgress(ratingKey!, currentPositionRef.current, playbackInfo.duration, 'stopped', playbackInfo.sessionId, source).catch(() => {});
      await api.stopPlayback(playbackInfo.sessionId, source).catch(() => {});
    }
    if (progressInterval.current) clearInterval(progressInterval.current);
    router.back();
  }, [ratingKey, playbackInfo]);

  // Back — hides controls first, then exits player on second press
  const handleBack = useCallback(async () => {
    if (showSettings) { setShowSettings(false); return; }
    if (showControls) {
      setShowControls(false);
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
      return;
    }
    await exitPlayer();
  }, [showSettings, showControls, exitPlayer]);

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => { handleBack(); return true; });
    return () => handler.remove();
  }, [handleBack]);

  // Skip marker (intro/credits)
  const handleSkipMarker = useCallback(() => {
    if (!activeMarker) return;
    const key = `${activeMarker.type}-${activeMarker.startMs}`;
    skippedMarkers.current.add(key);
    if (player.current) {
      player.current.currentTime = activeMarker.endMs / 1000;
      currentPositionRef.current = activeMarker.endMs;
      setDisplayPosition(activeMarker.endMs);
    }
    setActiveMarker(null);
    setShowControls(false);
  }, [activeMarker]);

  // Play/Pause
  const handlePlayPause = useCallback(() => {
    resetControlsTimer();
    try {
      if (isPlaying) {
        player.current?.pause();
        setIsPlaying(false);
      } else {
        player.current?.play();
        setIsPlaying(true);
      }
    } catch (e) {
      console.error('[Player] Play/pause error:', e);
    }
  }, [isPlaying, resetControlsTimer, player]);

  // Seek (from control buttons)
  const handleSeek = useCallback((deltaSeconds: number) => {
    resetControlsTimer();
    doSeek(deltaSeconds);
  }, [resetControlsTimer, doSeek]);

  // Bitrate change — request a new stream from the server with the selected quality
  const handleBitrateChange = useCallback(async (bitrate: number) => {
    if (!playbackInfo || !ratingKey) {
      console.log('[Player] handleBitrateChange: no playbackInfo or ratingKey');
      return;
    }
    console.log('[Player] handleBitrateChange: bitrate=' + bitrate);
    setSelectedBitrate(bitrate);
    setShowSettings(false);
    resetControlsTimer();

    const currentTime = player.current?.currentTime || 0;
    console.log('[Player] currentTime=' + currentTime + ', pausing...');
    player.current?.pause();

    console.log('[Player] stopping old session: ' + playbackInfo.sessionId);
    await api.stopPlayback(playbackInfo.sessionId, source).catch((e) => console.log('[Player] stopPlayback error:', e));

    // Request new stream with specific bitrate — server handles transcode params
    const resolution = bitrate <= 2000 ? '720x480' : bitrate <= 4000 ? '1280x720' : '1920x1080';
    const isOriginal = bitrate === 0;
    console.log('[Player] requesting new stream: bitrate=' + bitrate + ', resolution=' + resolution + ', isOriginal=' + isOriginal);
    try {
      const newInfo = await api.getPlaybackInfo(ratingKey, {
        source,
        offset: currentPositionRef.current,
        maxBitrate: isOriginal ? undefined : bitrate,
        resolution: isOriginal ? undefined : resolution,
        subtitleStreamID: selectedSubtitleId === null ? undefined : selectedSubtitleId,
        audioStreamID: selectedAudioId ?? undefined,
      });
      console.log('[Player] got new stream URL (first 100 chars): ' + newInfo.streamUrl.slice(0, 100));
      console.log('[Player] new sessionId: ' + newInfo.sessionId);

      setPlaybackInfo((prev) => prev ? { ...prev, sessionId: newInfo.sessionId } : prev);
      currentPositionRef.current = Math.floor(currentTime * 1000);
      setStreamUrl(newInfo.streamUrl);
      setPlayerKey((k) => {
        console.log('[Player] playerKey: ' + k + ' -> ' + (k + 1));
        return k + 1;
      });
    } catch (e) {
      console.error('[Player] getPlaybackInfo error:', e);
    }
  }, [playbackInfo, ratingKey, resetControlsTimer, selectedSubtitleId, selectedAudioId]);

  // Subtitle/Audio change — restart stream with new track selection
  const handleTrackChange = useCallback(async (type: 'subtitle' | 'audio', trackId: number | null) => {
    if (!playbackInfo || !ratingKey) return;
    console.log('[Player] handleTrackChange: type=' + type + ', trackId=' + trackId);
    if (type === 'subtitle') setSelectedSubtitleId(trackId);
    else setSelectedAudioId(trackId);
    setShowSettings(false);
    resetControlsTimer();

    const currentTime = player.current?.currentTime || 0;
    console.log('[Player] track change currentTime=' + currentTime);
    player.current?.pause();
    await api.stopPlayback(playbackInfo.sessionId, source).catch(() => {});

    const resolution = selectedBitrate <= 2000 ? '720x480' : selectedBitrate <= 4000 ? '1280x720' : '1920x1080';
    const isOriginal = selectedBitrate === 0;
    const subId = type === 'subtitle' ? trackId : selectedSubtitleId;
    const audId = type === 'audio' ? trackId : selectedAudioId;
    console.log('[Player] track request: subId=' + subId + ' audId=' + audId + ' bitrate=' + selectedBitrate);

    try {
      const newInfo = await api.getPlaybackInfo(ratingKey, {
        source,
        offset: currentPositionRef.current,
        maxBitrate: isOriginal ? undefined : selectedBitrate,
        resolution: isOriginal ? undefined : resolution,
        subtitleStreamID: subId === null ? 0 : subId,
        audioStreamID: audId ?? undefined,
      });
      console.log('[Player] track change got new URL, sessionId=' + newInfo.sessionId);

      setPlaybackInfo((prev) => prev ? { ...prev, sessionId: newInfo.sessionId } : prev);
      currentPositionRef.current = Math.floor(currentTime * 1000);
      setStreamUrl(newInfo.streamUrl);
      setPlayerKey((k) => {
        console.log('[Player] track playerKey: ' + k + ' -> ' + (k + 1));
        return k + 1;
      });
    } catch (e) {
      console.error('[Player] track change FAILED:', (e as Error).message);
      // Resume playback on error
      try { player.current?.play(); setIsPlaying(true); } catch {}
    }
  }, [playbackInfo, ratingKey, resetControlsTimer, player, selectedBitrate, selectedSubtitleId, selectedAudioId]);

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

  const playerContent = (
      <View style={styles.container}>
        <View style={styles.videoContainer} pointerEvents="none">
          <VideoPlayerView
            key={playerKey}
            url={streamUrl}
            resumePosition={playerKey > 0 ? currentPositionRef.current : 0}
            onPlayer={handlePlayerReady}
            onPlaying={handlePlayingState}
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
            visible={showControls || !!activeMarker}
            playing={isPlaying}
            displayPosition={displayPosition}
            duration={playbackInfo?.duration || 0}
            title={playbackInfo?.title || ''}
            onPlayPause={handlePlayPause}
            onSeekBack={() => handleSeek(-30)}
            onSeekForward={() => handleSeek(30)}
            onQuality={() => { setSettingsMode('quality'); setShowSettings(true); if (!isTV) setShowControls(true); }}
            onSubtitles={() => { setSettingsMode('subtitles'); setShowSettings(true); }}
            onAudio={() => { setSettingsMode('audio'); setShowSettings(true); }}
            onBack={exitPlayer}
            onInteraction={resetControlsTimer}
            onProgressFocusChange={setProgressBarFocused}
            hasSubtitles={(playbackInfo?.subtitles?.length || 0) > 0}
            hasAudioTracks={(playbackInfo?.audioTracks?.length || 0) > 1}
            activeMarker={activeMarker}
            onSkipMarker={handleSkipMarker}
          />
        )}

        {/* Seek indicator overlay — shown when seeking with controls hidden */}
        {!showControls && seekDirection && (
          <SeekIndicator direction={seekDirection} seconds={seekAmount} />
        )}

        {/* Settings picker (quality / subtitles / audio) */}
        <Modal visible={showSettings} transparent animationType="fade" onRequestClose={() => setShowSettings(false)}>
          <Pressable style={styles.settingsOverlay} onPress={() => setShowSettings(false)}>
            <Pressable style={styles.settingsPanel} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.settingsTitle}>
                {settingsMode === 'quality' ? 'Video Quality' : settingsMode === 'subtitles' ? 'Subtitles' : 'Audio Track'}
              </Text>
              {settingsMode === 'quality' && (
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
              )}
              {settingsMode === 'subtitles' && (
                <FlatList
                  data={[{ id: 0, title: 'None', language: '', index: 0, selected: false }, ...(playbackInfo?.subtitles || [])]}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={({ item, index }) => {
                    const isSelected = item.id === 0 ? selectedSubtitleId === null : selectedSubtitleId === item.id;
                    return (
                      <Pressable
                        style={[styles.bitrateOption, isSelected && styles.bitrateSelected,
                          isTV && focusedBitrate === item.id && styles.bitrateFocused]}
                        onPress={() => handleTrackChange('subtitle', item.id === 0 ? null : item.id)}
                        onFocus={() => setFocusedBitrate(item.id)}
                        onBlur={() => setFocusedBitrate(null)}
                        focusable={true} hasTVPreferredFocus={index === 0}>
                        <Text style={[styles.bitrateText, isSelected && styles.bitrateTextSelected]}>
                          {item.title}
                        </Text>
                        {isSelected && <Text style={styles.bitrateCheck}>✓</Text>}
                      </Pressable>
                    );
                  }}
                />
              )}
              {settingsMode === 'audio' && (
                <FlatList
                  data={playbackInfo?.audioTracks || []}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={({ item, index }) => {
                    const isSelected = selectedAudioId === item.id;
                    return (
                      <Pressable
                        style={[styles.bitrateOption, isSelected && styles.bitrateSelected,
                          isTV && focusedBitrate === item.id && styles.bitrateFocused]}
                        onPress={() => handleTrackChange('audio', item.id)}
                        onFocus={() => setFocusedBitrate(item.id)}
                        onBlur={() => setFocusedBitrate(null)}
                        focusable={true} hasTVPreferredFocus={index === 0}>
                        <Text style={[styles.bitrateText, isSelected && styles.bitrateTextSelected]}>
                          {item.title}
                        </Text>
                        {isSelected && <Text style={styles.bitrateCheck}>✓</Text>}
                      </Pressable>
                    );
                  }}
                />
              )}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
  );

  // On TV, wrap in a focusable Pressable that captures D-pad when controls are hidden.
  // When controls show, the control buttons steal focus. When they hide, focus returns here.
  if (isTV) return (
    <Pressable
      style={styles.container}
      focusable={true}
      onPress={() => {
        if (!showControls) resetControlsTimer();
      }}
    >
      {playerContent}
    </Pressable>
  );
  return (
    <TouchableWithoutFeedback onPress={handleScreenPress}>
      {playerContent}
    </TouchableWithoutFeedback>
  );
}

const tvStyles = StyleSheet.create({
  seekIndicator: {
    position: 'absolute', top: '40%', left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  seekText: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: spacing.xs },
  overlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)', padding: spacing.lg, paddingBottom: spacing.xl,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: spacing.md },
  progressContainer: {
    marginBottom: spacing.md, padding: spacing.xs,
  },
  progressTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, position: 'relative' },
  progressFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  progressThumb: {
    position: 'absolute', top: -6, width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.primary, marginLeft: -8,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  time: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg },
  controlsSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  btn: {
    padding: spacing.sm, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  btnFocused: { borderColor: colors.focus, backgroundColor: 'rgba(255,255,255,0.25)' },
  btnPlay: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 26, marginHorizontal: spacing.lg },
  btnSkip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 22,
    gap: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  btnSkipFocused: {
    borderColor: '#fff',
    transform: [{ scale: 1.05 }],
  },
  btnSkipText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
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
