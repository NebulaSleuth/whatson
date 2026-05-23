import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { ContentItem } from '@whatson/shared';
import { api } from '@/lib/api';

interface Props {
  item: ContentItem;
  onClose: () => void;
}

export function VideoPlayer({ item, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        setStatus('Requesting stream…');
        const info = await api.getPlaybackInfo(item.sourceId, {
          source: item.source,
          offset: item.progress?.currentPosition,
        });
        if (cancelled) return;
        sessionRef.current = info.sessionId;
        const video = videoRef.current;
        if (!video) return;

        const url = info.streamUrl;
        // Safari natively handles HLS via `src`. Everything else needs
        // hls.js to demux .m3u8 manifests into a MediaSource buffer.
        const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
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
          setError('This browser cannot play HLS streams.');
          return;
        }

        // Seek to resume position once metadata loads.
        if (info.viewOffset && info.viewOffset > 0) {
          const onLoaded = () => {
            video.currentTime = info.viewOffset / 1000;
            video.removeEventListener('loadedmetadata', onLoaded);
          };
          video.addEventListener('loadedmetadata', onLoaded);
        }
        setStatus('');
      } catch (e) {
        setError((e as Error).message);
      }
    }

    start();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAndStop();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return () => {
      cancelled = true;
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (sessionRef.current) {
        // Best-effort — clean up the transcode session server-side.
        api.stopPlayback(sessionRef.current, item.source).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  function closeAndStop() {
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeAndStop();
      }}
    >
      <button
        onClick={closeAndStop}
        aria-label="Close player"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white text-2xl z-10"
      >
        ×
      </button>

      {error ? (
        <div className="text-center p-6">
          <p className="text-red-400 font-semibold mb-2">{error}</p>
          <button onClick={closeAndStop} className="px-4 py-2 bg-primary text-black rounded font-semibold">
            Close
          </button>
        </div>
      ) : (
        <>
          {status && <p className="absolute top-4 left-4 text-white">{status}</p>}
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            className="max-w-full max-h-full"
            onError={() => setError('The browser couldn\'t play this stream.')}
          />
        </>
      )}
    </div>
  );
}
