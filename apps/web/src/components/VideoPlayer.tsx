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
    try {
      swappingRef.current = true;
      setError(null);
      setStatus('Requesting stream…');
      const next = await api.getPlaybackInfo(item.sourceId, {
        source: item.source,
        offset: opts.offset ?? (info ? undefined : item.progress?.currentPosition),
        audioStreamID: opts.audio,
        subtitleStreamID: opts.subtitle,
        maxBitrate: opts.bitrate,
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

      // Detach the old source cleanly before attaching a new one.
      // For the hls.js path, destroying the instance also detaches
      // its MediaSource. For native HLS (Safari) we'll overwrite
      // video.src below, no extra reset needed.
      try { video.pause(); } catch {}
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
      const url = next.streamUrl;

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
      const onLoaded = () => {
        if (seekToMs > 0) {
          try { video.currentTime = seekToMs / 1000; } catch {}
        }
        video.play().catch((err) => console.warn('[player] play rejected', err.name));
        requestAnimationFrame(() => { swappingRef.current = false; });
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true });

      if (canNativeHls) {
        video.src = url;
      } else if (Hls.isSupported()) {
        // Jellyfin / Emby transcode segments on demand. The HLS
        // manifest lists every segment up front, but if the
        // transcoder hasn't reached one yet the request 404s.
        // Bump retry budgets and recover from transient network
        // errors instead of bubbling them to the user as fatal.
        const hls = new Hls({
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
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          // Try to recover from common transient failures before
          // surfacing an error to the user.
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            console.warn('[hls] network error — retrying', data.details);
            try { hls.startLoad(); return; } catch {}
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            console.warn('[hls] media error — recovering', data.details);
            try { hls.recoverMediaError(); return; } catch {}
          }
          setError(`Playback error: ${data.type} / ${data.details}`);
        });
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
    // Absolute original-timeline position = current base + the
    // local video.currentTime within the active stream.
    const currentOffsetMs = v
      ? Math.floor((baseSecondsRef.current + v.currentTime) * 1000)
      : undefined;
    setMenu('none');
    if (opts.audio !== undefined) setAudioId(opts.audio);
    if (opts.subtitle !== undefined) setSubtitleId(opts.subtitle);
    if ('bitrate' in opts) setMaxBitrate(opts.bitrate);

    // CRITICAL: terminate the prior transcode session BEFORE asking
    // Plex for a new one. Without this the second /api/playback call
    // inherits the still-active session's audio / subtitle / bitrate
    // and our UI selection has no effect (the v0.1.49 bug).
    // Awaiting the stop also gives Plex a moment to actually tear
    // the session down before we race a new request at it.
    if (v) v.pause();
    if (sessionRef.current) {
      try {
        await api.stopPlayback(sessionRef.current, item.source);
      } catch {
        /* best-effort — even if stop fails we'll try the new stream */
      }
      sessionRef.current = null;
    }

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
