import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { LiveChannel } from '@whatson/shared';
import { api } from '@/lib/api';

interface Props {
  channel: LiveChannel;
  onClose: () => void;
}

// Stripped-down counterpart to VideoPlayer for live tuner streams.
// No resume/progress reporting, no audio/subtitle/quality menus,
// no stopPlayback POST — live is a fire-and-forget HLS attach.
// The backend's ffmpeg HLS session ends ~30s after the segment
// requests stop coming in.
export function LiveVideoPlayer({ channel, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [status, setStatus] = useState('Tuning…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;

    async function start() {
      try {
        const info = await api.getLiveStreamInfo(channel.id);
        if (aborted) return;
        const video = videoRef.current;
        if (!video) return;

        const url = info.url;
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            // Live-friendly buffer settings — keep the playhead near
            // the live edge without buffering forever.
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 6,
            manifestLoadingMaxRetry: 8,
            manifestLoadingRetryDelay: 1000,
            levelLoadingMaxRetry: 8,
            fragLoadingMaxRetry: 12,
          });
          hlsRef.current = hls;
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              try { hls.startLoad(); return; } catch {}
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              try { hls.recoverMediaError(); return; } catch {}
            }
            setError(`Playback error: ${data.details}`);
          });
          hls.attachMedia(video);
          hls.loadSource(url);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url;
        } else {
          setError("This browser cannot play HLS streams.");
          return;
        }

        const onPlaying = () => setStatus('');
        video.addEventListener('playing', onPlaying, { once: true });
        video.play().catch(() => {});
      } catch (e) {
        if (!aborted) setError((e as Error).message);
      }
    }

    start();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return () => {
      aborted = true;
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [channel.id, onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-black flex items-center justify-center">
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 p-3 bg-gradient-to-b from-black/80 to-transparent">
        <button
          onClick={onClose}
          aria-label="Close player"
          className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white text-2xl"
        >
          ×
        </button>
        <div className="flex-1 min-w-0 text-white font-semibold truncate">
          {channel.number ? `${channel.number} — ` : ''}{channel.name}
        </div>
        <span className="px-2 py-1 text-xs font-bold bg-red-600 text-white rounded">LIVE</span>
      </div>

      {error ? (
        <div className="text-center p-6">
          <p className="text-red-400 font-semibold mb-2">{error}</p>
          <button onClick={onClose} className="px-4 py-2 bg-primary text-black rounded font-semibold">
            Close
          </button>
        </div>
      ) : (
        <>
          {status && (
            <p className="absolute bottom-20 left-1/2 -translate-x-1/2 text-white">{status}</p>
          )}
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            className="w-screen h-screen object-contain bg-black"
          />
        </>
      )}
    </div>
  );
}
