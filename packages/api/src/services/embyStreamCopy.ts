/**
 * Copy-vs-transcode decision for Jellyfin / Emby HLS playback.
 *
 * `embyLike.getPlaybackInfo` used to force a full ffmpeg encode on every
 * request (AllowVideoStreamCopy / AllowAudioStreamCopy = false). That was
 * needed so subtitle / audio / quality picks actually take effect: when the
 * server is allowed to pass the source through, it ignores those params.
 * But when the viewer asks for *nothing* different from the source, a full
 * encode only burns CPU — on the 2-core demo VM it caps concurrent viewers.
 *
 * This module decides when the request is a "no change" request, so the
 * server may stream-copy (remux into HLS) instead. It is pure (no I/O) so
 * the decision can be unit-tested without a Jellyfin/Emby server.
 *
 * Anything we can't confirm matches the source counts as a change: an
 * unknown source bitrate with a bitrate cap, an unknown default audio
 * track with an audio pick, and so on. Falling back to a transcode is
 * always safe; a wrong copy would silently ignore the viewer's pick.
 */
import type { PlaybackOpts } from './adapters/types.js';

/** The parts of a Jellyfin/Emby MediaSource / MediaStream we look at. */
export interface CopySourceStream {
  Index?: number;
  Type?: string;
  IsDefault?: boolean;
  Width?: number;
  Height?: number;
}

export interface CopySourceInfo {
  /** Container bitrate in bits/s (MediaSource.Bitrate). */
  Bitrate?: number;
  DefaultAudioStreamIndex?: number;
  MediaStreams?: CopySourceStream[];
}

export interface StreamCopyDecision {
  allowCopy: boolean;
  /** Why we transcode (or 'no change requested'), for the debug log. */
  reason: string;
}

/** Index of the audio track the server plays when no AudioStreamIndex is sent. */
export function defaultAudioIndex(source: CopySourceInfo | undefined): number | undefined {
  if (!source) return undefined;
  if (source.DefaultAudioStreamIndex != null) return source.DefaultAudioStreamIndex;
  const audio = (source.MediaStreams || []).filter((st) => st.Type === 'Audio');
  return (audio.find((st) => st.IsDefault) ?? audio[0])?.Index;
}

function parseResolution(res: string): { w: number; h: number } | null {
  const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(res);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

export function decideStreamCopy(
  playOpts: PlaybackOpts,
  source: CopySourceInfo | undefined,
): StreamCopyDecision {
  const transcode = (reason: string): StreamCopyDecision => ({ allowCopy: false, reason });

  if (playOpts.forceTranscode) return transcode('forceTranscode');

  // Burned-in subtitle needs the video re-encoded. 0 / null / -1 = off.
  if (playOpts.subtitleStreamID != null && playOpts.subtitleStreamID > 0) {
    return transcode(`subtitle burn-in (stream ${playOpts.subtitleStreamID})`);
  }

  // A picked audio track only counts as "no change" when it's the one the
  // server would play anyway.
  if (playOpts.audioStreamID != null) {
    const def = defaultAudioIndex(source);
    if (def == null) return transcode(`audio pick ${playOpts.audioStreamID} (source default unknown)`);
    if (playOpts.audioStreamID !== def) {
      return transcode(`non-default audio ${playOpts.audioStreamID} (default ${def})`);
    }
  }

  // Clients send a bitrate even for "Original" (Roku sends 20000), so a cap
  // only counts when it's below the source.
  if (playOpts.maxBitrate != null && playOpts.maxBitrate > 0) {
    const sourceBps = source?.Bitrate;
    if (!sourceBps || sourceBps <= 0) return transcode(`bitrate cap ${playOpts.maxBitrate}kbps (source bitrate unknown)`);
    if (playOpts.maxBitrate * 1000 < sourceBps) {
      return transcode(`bitrate cap ${playOpts.maxBitrate}kbps < source ${Math.round(sourceBps / 1000)}kbps`);
    }
  }

  if (playOpts.resolution) {
    const want = parseResolution(playOpts.resolution);
    const video = (source?.MediaStreams || []).find((st) => st.Type === 'Video');
    if (!want || !video?.Width || !video?.Height) {
      return transcode(`resolution cap ${playOpts.resolution} (source size unknown)`);
    }
    if (want.w < video.Width || want.h < video.Height) {
      return transcode(`resolution cap ${playOpts.resolution} < source ${video.Width}x${video.Height}`);
    }
  }

  return { allowCopy: true, reason: 'no change requested' };
}
