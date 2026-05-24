import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { ContentItem } from '@whatson/shared';
import { api } from '@/lib/api';

interface Props {
  item: ContentItem;
  onClose: () => void;
}

// Mirrors the mobile player's quality ladder.
const QUALITY_PRESETS: Array<{ label: string; maxBitrate?: number }> = [
  { label: 'Original (Direct Play)', maxBitrate: undefined },
  { label: '20 Mbps', maxBitrate: 20000 },
  { label: '12 Mbps 1080p', maxBitrate: 12000 },
  { label: '8 Mbps 1080p', maxBitrate: 8000 },
  { label: '4 Mbps 720p', maxBitrate: 4000 },
  { label: '3 Mbps 720p', maxBitrate: 3000 },
  { label: '2 Mbps 720p', maxBitrate: 2000 },
  { label: '1.5 Mbps 480p', maxBitrate: 1500 },
  { label: '720 kbps SD', maxBitrate: 720 },
];

type PlaybackInfo = Awaited<ReturnType<typeof api.getPlaybackInfo>>;

export function VideoPlayer({ item, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const sessionRef = useRef<string | null>(null);
  // Carries the AbortController for the current stream's video-element
  // listeners. Aborted at the top of every loadStream so the prior
  // stream's loadedmetadata / playing / error / diagnostic timer
  // don't leak into the new attach.
  const listenerAbortRef = useRef<AbortController | null>(null);
  // True while loadStream is detaching the old source and attaching
  // a new one. Suppresses the native <video> error event that fires
  // when the source is yanked out from under it — without this guard
  // we'd surface "couldn't play this stream" on every track swap.
  const swappingRef = useRef(false);
  // The original-timeline position (in seconds) that the current
  // stream's t=0 represents. After a swap with offset=N, video.currentTime
  // resets to 0 but the user is still at original position N. Adding
  // baseSecondsRef + video.currentTime gives the true position for
  // the next swap's offset.
  const baseSecondsRef = useRef(0);

  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<'none' | 'audio' | 'subtitles' | 'quality'>('none');
  // Current selections — mutated by the user; passed to the next
  // getPlaybackInfo call. Initialised from the first response.
  const [audioId, setAudioId] = useState<number | null>(null);
  const [subtitleId, setSubtitleId] = useState<number | null>(null);
  const [maxBitrate, setMaxBitrate] = useState<number | undefined>(undefined);

  // ── Load + (re)attach the HLS stream ──
  // `offset` lets us preserve playback position across quality / track
  // swaps. The first load uses the server-reported viewOffset.
  async function loadStream(opts: { offset?: number; audio?: number; subtitle?: number; bitrate?: number } = {}) {
    const t0 = performance.now();
    const tag = `[player] loadStream`;
    console.log(`${tag} START opts=`, opts, 'baseSeconds=', baseSecondsRef.current);
    // Drop the prior stream's listeners so loadedmetadata / playing /
    // error / timer events from the now-detached source don't bleed
    // into this attach.
    if (listenerAbortRef.current) {
      listenerAbortRef.current.abort();
      listenerAbortRef.current = null;
    }
    const ac = new AbortController();
    listenerAbortRef.current = ac;

    try {
      swappingRef.current = true;
      setError(null);
      setStatus('Requesting stream…');
      const reqStart = performance.now();
      const next = await api.getPlaybackInfo(item.sourceId, {
        source: item.source,
        offset: opts.offset ?? (info ? undefined : item.progress?.currentPosition),
        audioStreamID: opts.audio,
        subtitleStreamID: opts.subtitle,
        maxBitrate: opts.bitrate,
      });
      console.log(`${tag} got playback info in`, Math.round(performance.now() - reqStart), 'ms', {
        sessionId: next.sessionId?.slice(0, 12),
        streamUrl: next.streamUrl,
        viewOffset: next.viewOffset,
        duration: next.duration,
        audioCount: next.audioTracks.length,
        subCount: next.subtitles.length,
        selectedAudio: next.audioTracks.find((t) => t.selected)?.id,
        selectedSub: next.subtitles.find((t) => t.selected)?.id,
      });
      sessionRef.current = next.sessionId;
      setInfo(next);

      // Record the base offset for this stream so the next swap can
      // pass the right absolute position. If we requested an offset
      // the new stream represents that point at t=0. First loads
      // have no offset; the seek-to-viewOffset path below leaves
      // baseSecondsRef at 0 and currentTime carries the position.
      if (opts.offset !== undefined) {
        baseSecondsRef.current = Math.floor(opts.offset / 1000);
      } else {
        baseSecondsRef.current = 0;
      }

      // Initialise selections only on the first load.
      if (!info) {
        const sel = next.audioTracks.find((t) => t.selected);
        if (sel) setAudioId(sel.id);
        const subSel = next.subtitles.find((t) => t.selected);
        if (subSel) setSubtitleId(subSel.id);
      }

      const video = videoRef.current;
      if (!video) return;

      try { video.pause(); } catch {}

      // Prefer hls.js everywhere it's supported. Chromium-based
      // browsers (including Edge / new Chrome) sometimes claim
      // native HLS support via canPlayType but their actual
      // implementation doesn't handle source swaps cleanly — the
      // <video> element ends up at networkState=3 with no source
      // ever installed. hls.js handles this path correctly. Only
      // fall back to native HLS when hls.js isn't available
      // (Safari on iOS, where MSE is restricted).
      const hlsJsSupported = Hls.isSupported();
      const canNativeHls = !hlsJsSupported && video.canPlayType('application/vnd.apple.mpegurl') !== '';
      const url = next.streamUrl;
      console.log(`${tag} attach path: ${hlsJsSupported ? 'hls.js' : canNativeHls ? 'native HLS' : 'unsupported'} userAgent=${navigator.userAgent}`);

      // Register the seek-and-play listener BEFORE attaching the new
      // source — hls.js can fire loadedmetadata synchronously after a
      // fast manifest load, and a listener added afterwards would
      // miss it. `once: true` keeps it from re-firing on subsequent
      // manifest reloads within the same stream.
      //
      // Seek logic: when we asked the backend for `offset`, Plex
      // returns a stream that already starts at that point — its
      // internal t=0 IS our position, so we MUST NOT seek the
      // element again or we'd land far past the end. Only seek on
      // the first load where the server-reported viewOffset > 0.
      const isSwap = opts.offset !== undefined;
      const seekToMs = isSwap ? 0 : (next.viewOffset > 0 ? next.viewOffset : 0);
      console.log(`${tag} isSwap=${isSwap} seekToMs=${seekToMs} baseSecondsRef=${baseSecondsRef.current}`);

      const tAttach = performance.now();
      const logTimer = window.setInterval(() => {
        console.log(
          `${tag} waiting after ${Math.round(performance.now() - tAttach)}ms — ` +
          `paused=${video.paused} readyState=${video.readyState} ` +
          `networkState=${video.networkState} currentTime=${video.currentTime.toFixed(2)} ` +
          `buffered=${video.buffered.length}`,
        );
      }, 2000);

      const onLoaded = () => {
        console.log(`${tag} loadedmetadata after`, Math.round(performance.now() - tAttach), 'ms', {
          videoDuration: video.duration,
          readyState: video.readyState,
          seekToMs,
        });
        if (seekToMs > 0) {
          try {
            video.currentTime = seekToMs / 1000;
            console.log(`${tag} seek done to`, seekToMs / 1000, 's');
          } catch (e) {
            console.warn(`${tag} seek failed`, e);
          }
        }
        video.play().then(
          () => console.log(`${tag} play() resolved`),
          (err) => console.warn(`${tag} play() rejected`, err.name, err.message),
        );
        requestAnimationFrame(() => { swappingRef.current = false; });
      };
      const onPlaying = () => {
        console.log(`${tag} 'playing' event after`, Math.round(performance.now() - tAttach), 'ms');
        window.clearInterval(logTimer);
      };
      const onError = () => {
        const err = video.error;
        console.warn(`${tag} video.onerror after`, Math.round(performance.now() - tAttach), 'ms', {
          code: err?.code,
          message: err?.message,
          networkState: video.networkState,
          readyState: video.readyState,
        });
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true, signal: ac.signal });
      video.addEventListener('playing', onPlaying, { once: true, signal: ac.signal });
      video.addEventListener('error', onError, { signal: ac.signal });
      ac.signal.addEventListener('abort', () => window.clearInterval(logTimer));
      // Drop the diagnostic timer after a generous window so we
      // don't spam the console for streams that just take a while.
      window.setTimeout(() => window.clearInterval(logTimer), 60_000);

      if (hlsJsSupported) {
        // hls.js's intended swap pattern is `loadSource(newUrl)` on
        // the existing instance — destroy+recreate leaves the
        // <video> in a half-attached state and the new attachMedia
        // silently no-ops at networkState=3 (NETWORK_NO_SOURCE),
        // which is the bug we kept seeing. So: create the instance
        // ONCE on first load, attach event handlers ONCE, and just
        // call loadSource for every subsequent swap.
        let hls = hlsRef.current;
        const fresh = !hls;
        if (!hls) {
          hls = new Hls({
            enableWorker: true,
            manifestLoadingMaxRetry: 6,
            manifestLoadingRetryDelay: 1000,
            levelLoadingMaxRetry: 6,
            levelLoadingRetryDelay: 1000,
            fragLoadingMaxRetry: 12,
            fragLoadingRetryDelay: 1000,
            fragLoadingMaxRetryTimeout: 30_000,
          });
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_LOADED, (_e, data) => {
            console.log(`[hls] manifest loaded — levels=${data.levels.length} ` +
              `audioTracks=${data.audioTracks?.length ?? 0}`);
          });
          hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
            console.log(`[hls] level ${data.level} loaded — totalduration=${data.details.totalduration} fragments=${data.details.fragments.length}`);
          });
          hls.on(Hls.Events.FRAG_LOADED, (_e, data) => {
            if (typeof data.frag.sn === 'number' && data.frag.sn < 3) {
              console.log(`[hls] frag loaded sn=${data.frag.sn} duration=${data.frag.duration}`);
            }
          });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            console.warn(`[hls] error type=${data.type} details=${data.details} fatal=${data.fatal} ` +
              `response=${data.response?.code ?? '-'} url=${data.frag?.url ?? data.url ?? '-'}`);
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              console.warn('[hls] fatal network error — retrying');
              try { hls!.startLoad(); return; } catch {}
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              console.warn('[hls] fatal media error — recovering');
              try { hls!.recoverMediaError(); return; } catch {}
            }
            setError(`Playback error: ${data.type} / ${data.details}`);
          });
          hls.attachMedia(video);
        }
        hls.loadSource(url);
        console.log(`${tag} hls.loadSource (${fresh ? 'fresh instance' : 'reused instance'}) url=${url.slice(0, 120)}`);
      } else if (canNativeHls) {
        video.src = url;
      } else {
        setError("This browser cannot play HLS streams.");
        return;
      }
      setStatus('');
    } catch (e) {
      swappingRef.current = false;
      setError((e as Error).message);
    }
  }

  // First load on mount.
  useEffect(() => {
    loadStream();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (sessionRef.current) {
        api.stopPlayback(sessionRef.current, item.source).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function swap(opts: { audio?: number; subtitle?: number; bitrate?: number }) {
    const v = videoRef.current;
    const tStart = performance.now();
    const currentOffsetMs = v
      ? Math.floor((baseSecondsRef.current + v.currentTime) * 1000)
      : undefined;
    console.log('[player] swap', {
      opts,
      videoCurrentTime: v?.currentTime,
      baseSeconds: baseSecondsRef.current,
      computedOffsetMs: currentOffsetMs,
      priorSession: sessionRef.current?.slice(0, 12),
    });
    setMenu('none');
    if (opts.audio !== undefined) setAudioId(opts.audio);
    if (opts.subtitle !== undefined) setSubtitleId(opts.subtitle);
    if ('bitrate' in opts) setMaxBitrate(opts.bitrate);

    // CRITICAL: terminate the prior transcode session BEFORE asking
    // Plex for a new one. Without this the second /api/playback call
    // inherits the still-active session's audio / subtitle / bitrate
    // and our UI selection has no effect (the v0.1.49 bug).
    if (v) v.pause();
    if (sessionRef.current) {
      try {
        const stopStart = performance.now();
        await api.stopPlayback(sessionRef.current, item.source);
        console.log('[player] stopPlayback resolved in', Math.round(performance.now() - stopStart), 'ms');
      } catch (e) {
        console.warn('[player] stopPlayback failed', (e as Error).message);
      }
      sessionRef.current = null;
    }
    console.log('[player] swap → loadStream after', Math.round(performance.now() - tStart), 'ms');

    loadStream({
      offset: currentOffsetMs,
      audio: opts.audio !== undefined ? opts.audio : audioId ?? undefined,
      subtitle: opts.subtitle !== undefined ? opts.subtitle : subtitleId ?? undefined,
      bitrate: opts.bitrate !== undefined ? opts.bitrate : maxBitrate,
    });
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black flex items-center justify-center">
      {/* Top toolbar — always visible. Close + track / quality menus. */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 p-3 bg-gradient-to-b from-black/80 to-transparent">
        <button
          onClick={onClose}
          aria-label="Close player"
          className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white text-2xl"
        >
          ×
        </button>
        <div className="flex-1 min-w-0 text-white font-semibold truncate">
          {info ? (info.showTitle ? `${info.showTitle} — ${info.title}` : info.title) : item.title}
        </div>
        {info && info.audioTracks.length > 1 && (
          <Pill on={menu === 'audio'} onClick={() => setMenu(menu === 'audio' ? 'none' : 'audio')}>
            Audio
          </Pill>
        )}
        {info && info.subtitles.length > 0 && (
          <Pill on={menu === 'subtitles'} onClick={() => setMenu(menu === 'subtitles' ? 'none' : 'subtitles')}>
            Subtitles
          </Pill>
        )}
        <Pill on={menu === 'quality'} onClick={() => setMenu(menu === 'quality' ? 'none' : 'quality')}>
          Quality
        </Pill>
      </div>

      {/* Optional dropdown menu under the toolbar. */}
      {menu !== 'none' && (
        <div className="absolute top-16 right-3 z-20 w-72 max-h-[60vh] overflow-y-auto bg-surface border border-card-border rounded shadow-2xl">
          {menu === 'audio' && info && (
            <Menu
              items={info.audioTracks.map((t) => ({
                key: String(t.id),
                label: t.title || t.language || `Audio ${t.index + 1}`,
                sub: t.language,
                selected: audioId === t.id,
                onClick: () => swap({ audio: t.id }),
              }))}
            />
          )}
          {menu === 'subtitles' && info && (
            <Menu
              items={[
                {
                  key: 'off',
                  label: 'Off',
                  selected: !subtitleId,
                  onClick: () => swap({ subtitle: 0 }),
                },
                ...info.subtitles.map((t) => ({
                  key: String(t.id),
                  label: t.title || t.language || `Track ${t.index + 1}`,
                  sub: t.language,
                  selected: subtitleId === t.id,
                  onClick: () => swap({ subtitle: t.id }),
                })),
              ]}
            />
          )}
          {menu === 'quality' && (
            <Menu
              items={QUALITY_PRESETS.map((p) => ({
                key: String(p.maxBitrate ?? 0),
                label: p.label,
                selected: maxBitrate === p.maxBitrate,
                onClick: () => swap({ bitrate: p.maxBitrate }),
              }))}
            />
          )}
        </div>
      )}

      {error ? (
        <div className="text-center p-6">
          <p className="text-red-400 font-semibold mb-2">{error}</p>
          <button onClick={onClose} className="px-4 py-2 bg-primary text-black rounded font-semibold">
            Close
          </button>
        </div>
      ) : (
        <>
          {status && <p className="absolute bottom-20 left-1/2 -translate-x-1/2 text-white">{status}</p>}
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            // Fill the viewport regardless of source resolution. A
            // 720p / SD transcode would otherwise render in its
            // natural size in a corner — object-contain scales the
            // frame to fit while preserving aspect ratio.
            className="w-screen h-screen object-contain bg-black"
            onError={() => {
              // Ignore the transient error events that fire as we
              // detach the previous source mid-swap.
              if (swappingRef.current) return;
              setError("The browser couldn't play this stream.");
            }}
          />
        </>
      )}
    </div>
  );
}

function Pill({ children, on, onClick }: { children: React.ReactNode; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-3 py-1.5 rounded text-sm font-semibold',
        on ? 'bg-primary text-black' : 'bg-black/60 text-white hover:bg-black/80',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Menu({ items }: { items: Array<{ key: string; label: string; sub?: string; selected: boolean; onClick: () => void }> }) {
  return (
    <ul className="py-2">
      {items.map((it) => (
        <li key={it.key}>
          <button
            onClick={it.onClick}
            className={[
              'w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-card-border',
              it.selected ? 'text-primary font-semibold' : 'text-text',
            ].join(' ')}
          >
            <span className="w-4 text-primary">{it.selected ? '✓' : ''}</span>
            <span className="flex-1">
              {it.label}
              {it.sub && it.sub !== it.label && (
                <span className="ml-2 text-xs text-text-muted">{it.sub}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
