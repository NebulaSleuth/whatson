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

      // Initialise selections only on the first load.
      if (!info) {
        const sel = next.audioTracks.find((t) => t.selected);
        if (sel) setAudioId(sel.id);
        const subSel = next.subtitles.find((t) => t.selected);
        if (subSel) setSubtitleId(subSel.id);
      }

      const video = videoRef.current;
      if (!video) return;

      // Tear down the old HLS instance before attaching a new source.
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
      const url = next.streamUrl;
      if (canNativeHls) {
        video.src = url;
      } else if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            setError(`Playback error: ${data.type} / ${data.details}`);
          }
        });
      } else {
        setError("This browser cannot play HLS streams.");
        return;
      }

      const seekTo = opts.offset ?? (next.viewOffset > 0 ? next.viewOffset : 0);
      if (seekTo > 0) {
        const onLoaded = () => {
          video.currentTime = seekTo / 1000;
          video.removeEventListener('loadedmetadata', onLoaded);
          video.play().catch(() => {});
        };
        video.addEventListener('loadedmetadata', onLoaded);
      } else {
        video.play().catch(() => {});
      }
      setStatus('');
    } catch (e) {
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

  function swap(opts: { audio?: number; subtitle?: number; bitrate?: number }) {
    const v = videoRef.current;
    const currentOffsetMs = v ? Math.floor(v.currentTime * 1000) : undefined;
    setMenu('none');
    if (opts.audio !== undefined) setAudioId(opts.audio);
    if (opts.subtitle !== undefined) setSubtitleId(opts.subtitle);
    if ('bitrate' in opts) setMaxBitrate(opts.bitrate);
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
            className="max-w-full max-h-full"
            onError={() => setError("The browser couldn't play this stream.")}
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
