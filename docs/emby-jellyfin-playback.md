# Emby & Jellyfin playback — bug history and design notes

This doc captures the load-bearing quirks behind `packages/api/src/services/embyLike.ts`. Most lines in that file exist because we hit a specific bug on a specific server version; ripping them out without understanding the bug will reintroduce it.

If you're touching Emby/Jellyfin playback, read this first.

---

## Diagnostic logging

The single most useful tool in this whole arc. Every Emby/Jellyfin playback decision is logged with the `[Emby.dbg]` / `[Jellyfin.dbg]` prefix. To inspect during debugging:

```
GET /api/logs?lines=500&filter=Emby.dbg
GET /api/logs?lines=500&filter=Jellyfin.dbg
```

Don't remove this logging. Every fix below was found by reading it.

---

## When in doubt: reproduce against the server directly

The fastest way to bisect any Emby/Jellyfin issue is to skip our backend and hit the server with `curl` directly. We have an api key (visible in the streamUrl logs before redaction) and the server URL. Examples:

```bash
# Minimal PlaybackInfo — does the server even respond?
curl -X POST "http://EMBY_HOST:8096/Items/{itemId}/PlaybackInfo?UserId={uid}&api_key={key}" \
  -H "Content-Type: application/json" \
  -d '{"DeviceProfile":{"MaxStreamingBitrate":20000000}}'

# Probe master.m3u8 — does it return 200? What manifest comes back?
curl -i "http://EMBY_HOST:8096/Videos/{itemId}/master.m3u8?..."
```

The MediaSourceId bug in v0.1.75 took 4 releases of guessing at DeviceProfile shape before a direct curl bisect found it in one minute. Reproduce first, theorise second.

---

## DeviceProfile contract

We always POST `/Items/{id}/PlaybackInfo` with this body shape. **Every field exists for a reason.**

```ts
{
  UserId, PlaySessionId,
  EnableDirectPlay: false,         // force transcode
  EnableDirectStream: false,
  EnableTranscoding: true,
  AllowVideoStreamCopy: false,
  AllowAudioStreamCopy: false,
  AutoOpenLiveStream: true,
  DeviceProfile: {
    MaxStreamingBitrate, MaxStaticBitrate, MusicStreamingTranscodingBitrate,
    DirectPlayProfiles: [...with VideoCodec + AudioCodec lists...],
    TranscodingProfiles: [{ Container: 'ts', Protocol: 'hls', VideoCodec: 'h264', AudioCodec: 'aac,mp3', ... }],
    SubtitleProfiles: [{ Format, Method: 'Encode' }, ...],
    CodecProfiles: [], ContainerProfiles: [], ResponseProfiles: [],
  },
  StartTimeTicks, MaxStreamingBitrate,
}
```

### Why DirectPlayProfiles needs explicit codec lists (v0.1.73 / v0.1.74)

Emby 4.9.x's profile matcher returns `ErrorCode=NoCompatibleStream` when `DirectPlayProfiles: []` is empty — even though we explicitly opt out of direct play via `EnableDirectPlay: false`. It uses the codec lists as advisory to confirm a playable chain exists at all. Jellyfin tolerates the empty array.

We list broad codec sets:

```ts
DirectPlayProfiles: [
  { Container: 'mp4,m4v,mkv,webm,mov,avi,ts,m2ts,3gp,flv',
    Type: 'Video',
    VideoCodec: 'h264,hevc,h265,mpeg4,mpeg2video,vp8,vp9,av1,vc1',
    AudioCodec: 'aac,mp3,ac3,eac3,opus,vorbis,flac,dts,truehd,pcm,alac,mp2' },
  { Container: 'mp3,aac,flac,ogg,wav,m4a,opus,mp2,ac3,eac3', Type: 'Audio' },
]
```

These are *advisory only* — `EnableDirectPlay: false` still gates actual direct play to false.

### Why force-transcoding (v0.1.62)

Without `EnableDirectPlay=false` + `EnableDirectStream=false`, Emby's PlaybackInfo can return `SupportsDirectStream=true` for files whose codecs already match our profile. The transcoder is never spun up, and stream params (`MaxStreamingBitrate`, `SubtitleStreamIndex`, `AudioStreamIndex`) get silently ignored — manifest reports source bitrate, subtitle picks no-op. Forcing transcode makes the params actually take effect.

### Why fresh PlaySessionId per request (v0.1.60)

Reusing Emby's echoed PlaySessionId causes the transcoder to *cache* its output regardless of new params on subsequent requests. Sending a fresh `whatson-emby-<timestamp>-<rand>` PlaySessionId forces a new transcoder.

### Why we DON'T send MediaSourceId in the PlaybackInfo query (v0.1.75)

Emby's `MediaSource.Id` is prefixed (`mediasource_9` for item `9`). Passing the raw itemId as `MediaSourceId` query param tells Emby `find this exact MediaSource` — which doesn't exist, so Emby returns `NoCompatibleStream`. Jellyfin's MediaSource.Id equals the item Id so it was historically a no-op. Both servers default to the item's primary MediaSource when MediaSourceId is omitted — which is what we want.

---

## URL selection (`useServerTranscodingUrl` gate)

```ts
const useServerTranscodingUrl =
  opts.source === 'jellyfin' && tuRaw && tuProtocol === 'hls';
```

**Jellyfin:** prefer the server's `TranscodingUrl`. Jellyfin bakes server-version-specific params (`SegmentContainer`, `VideoBitrate`, `MaxFramerate`, `h264-level`, `Tag`, `ApiKey`, `EnableAudioVbrEncoding`, ...) that we can't reliably reconstruct. The segment endpoint validates `Tag` against the prepared transcoder session — anything missing produces 400 on every segment. We honour `TranscodingUrl` as-is, only appending `StartTimeTicks` (Jellyfin doesn't bake it in but the master playlist endpoint reads it).

**Emby:** build our own `master.m3u8` URL. Emby 4.9.x reports `TranscodingSubProtocol='hls'` too, but its PlaybackInfo *silently ignores* `SubtitleStreamIndex` and `AudioStreamIndex` from the POST query — its `TranscodingUrl` uses Emby's own defaults (no `SubtitleStreamIndex`, default `AudioStreamIndex=1`). Subtitle/audio picks have no effect via TranscodingUrl. Constructing our own URL puts our params directly into the URL Emby's transcoder reads.

Verified directly: POST query `SubtitleStreamIndex=-1, AudioStreamIndex=2` → Emby's returned TranscodingUrl has `AudioStreamIndex=1` and no `SubtitleStreamIndex`.

---

## Subtitle handling

### "Off" needs `SubtitleMethod=External` on Emby (v0.1.78)

Users with `SubtitleMode: "Smart"` (Emby's default — check via `GET /Users/{id}`) have a server-side auto-pick mode that re-selects the `IsDefault=true` subtitle even when we ask for `SubtitleStreamIndex=-1`.

Plain `SubtitleStreamIndex=-1` doesn't suppress the burn. We need an explicit `SubtitleMethod`:

```ts
// off
streamParams.SubtitleStreamIndex = '-1';
streamParams.SubtitleMethod = 'External';
```

`SubtitleMethod=Drop` would be more obvious but Emby 4.9.5 rejects it: `HTTP 400 "Requested value 'Drop' was not found"`. `External` is in the enum; combined with index `-1` it means "external delivery of stream none" which the transcoder accepts as "don't burn anything."

### Burn-in needs both fields (v0.1.77)

```ts
// burn-in
streamParams.SubtitleStreamIndex = String(pickedIndex);
streamParams.SubtitleMethod = 'Encode';
```

### `selected: true` mirrors the request, not `IsDefault` (v0.1.80)

The client uses `subtitles[].selected` to initialise its subtitle dropdown. If we mark Arabic as `selected: true` because the source's MediaStream has `IsDefault=true`, the UI shows "Arabic" picked — but we're actually serving `SubtitleStreamIndex=-1` (off via `SubtitleMethod=External`). Result: UI/server disagree.

```ts
const requestedSubId = playOpts.subtitleStreamID > 0 ? playOpts.subtitleStreamID : null;
selected: requestedSubId != null && st.Index === requestedSubId
```

For audio we keep IsDefault fallback on initial load (the default audio track *is* what plays).

---

## StartTimeTicks (server seek) vs `clientSeekMs` (client seek)

`StartTimeTicks` tells the server to transcode from a specific source offset. The HLS playlist returned still spans the *full source duration*, but the transcoder's actual output starts at the seek point. Works most of the time — except when the seek interacts badly with subtitle burn or specific subtitle codecs.

Both issues have the same symptom: playlist + transcoder output disagree on what time fragment N represents, segment requests time out or 500. The fix in both cases is the same: drop `StartTimeTicks` server-side and have the client seek the video element locally.

### Image-sub seek bug (v0.1.67 / v0.1.79 — Jellyfin AND Emby)

Any file whose `MediaStreams` contains a PGS/DVB/DVD/VOB/HDMV subtitle stream — image-based, needing bitmap-over-video filter — produces broken segments when `StartTimeTicks > 0`, regardless of whether we're burning that subtitle. The seek path of FFmpeg's subtitle filter can't handle initial-position discontinuity.

### Sub-burn seek bug on Emby (v0.1.81 — text subs included)

Even text subtitles (ASS/SRT) on Emby break when we ask the transcoder to seek AND burn. Confirmed on multi-ASS file: with `StartTimeTicks=N AND SubtitleStreamIndex>0&SubtitleMethod=Encode`, segments time out at the seek-point fragment. Drop `StartTimeTicks` when burning any subtitle on Emby. Jellyfin's TranscodingUrl path handles seek+burn correctly so this is Emby-only.

### The trigger

```ts
const isEmbySubBurn = opts.source === 'emby' && subIndexForBody > 0;
const shouldDropStartTicks =
  sourceHasImageSubs || isImageBasedSub || isEmbySubBurn;
const effectiveStartTicks = shouldDropStartTicks ? 0 : startTicks;
const clientSeekMs = shouldDropStartTicks && startTicks > 0
  ? Math.floor(startTicks / TICKS_PER_MS) : 0;
```

When `shouldDropStartTicks` is true:
- We **delete** `StartTimeTicks` from `streamParams` (this was a bug in v0.1.79 — streamParams was built with raw startTicks *before* effectiveStartTicks was computed).
- `viewOffset` in the response is set to `effectiveStartTicks / TICKS_PER_MS` (i.e., 0) so the client's `baseSecondsRef` stays aligned.
- `clientSeekMs` carries the absolute source position to the client.

### Client honors `clientSeekMs`

When `clientSeekMs > 0`:
- Web `VideoPlayer.tsx` seeks the video element to `clientSeekMs / 1000` via the `MANIFEST_LOADED` handler.
- Mobile sets `currentPositionRef.current = clientSeekMs` and resumePosition prop picks it up.
- Roku uses it as the top-precedence resume source in `onPlaybackResponse`.

---

## Quality picks (`VideoBitrate` is mandatory on Emby — v0.1.82)

`MaxStreamingBitrate` in the master.m3u8 URL is treated by Emby as a direct-play decision hint and otherwise ignored. To actually change the transcode target bitrate, send `VideoBitrate`:

```ts
const totalBps = (playOpts.maxBitrate || 20000) * 1000;
const audioBps = 192_000;
const videoBps = Math.max(300_000, totalBps - audioBps);
streamParams.VideoBitrate = String(videoBps);
streamParams.AudioBitrate = String(audioBps);
```

Without `VideoBitrate`, Emby's manifest reports source bitrate / resolution regardless of pick. Direct probe confirms:

| `VideoBitrate` | Resolution | Bandwidth |
|---|---|---|
| 19808000 | 1420x1080 | 3879538 |
| 1808000  | 720x548   | 2400000  |

Emby auto-scales resolution down when VideoBitrate is constrained.

Quality is verifiable in the browser via DevTools → Network → `master.m3u8` response — the `BANDWIDTH=` and `RESOLUTION=` lines change with each quality pick.

---

## Session tracking & resume

### Echoed PlaySessionId only on Jellyfin (v0.1.67)

Jellyfin only updates `UserData.PlaybackPositionTicks` when `/Sessions/Playing/Progress` posts arrive with a `PlaySessionId` it tracks. The TranscodingUrl Jellyfin returns is keyed off its own echoed id, so we hand that back to the client (gated on `opts.source === 'jellyfin'` since Emby uses our generated id end-to-end).

```ts
const useServerSession = !!(
  opts.source === 'jellyfin' &&
  mediaSource?.TranscodingUrl &&
  mediaSource?.TranscodingSubProtocol === 'hls' &&
  echoedSessionId
);
const sessionId = useServerSession ? echoedSessionId : ourSessionId;
```

Emby accepts arbitrary PlaySessionId values and tracks `/Progress` against them; using `ourSessionId` keeps segment-fetching and `/Progress` reporting aligned.

### Belt-and-suspenders UserData write on stop (v0.1.67)

`/Sessions/Playing/Stopped` only saves the resume position when the server recognises the session. As a safety net, `stopPlayback` also POSTs `PlaybackPositionTicks` directly to `/Users/{id}/Items/{id}/UserData` — guaranteed to update resume regardless of session tracking state.

### Source prefix strip in adapter

ContentItem.id is `${source}-${jellyfinItemId}` for cross-server dedup. The `/playback/:ratingKey` GET path is hit with the unprefixed `sourceId`, but `/progress` and `/stop` historically got called with both shapes from different platforms. Strip the prefix defensively in the adapter:

```ts
const sourcePrefix = `${opts.source}-`;
const stripPrefix = (id: string) =>
  id.startsWith(sourcePrefix) ? id.slice(sourcePrefix.length) : id;
```

---

## Web-only player quirks (don't apply to mobile/Roku)

hls.js reuses the same MSE source across `loadSource` calls — the underlying `<video>` element doesn't reload. Two consequences require workarounds:

### `loadedmetadata` doesn't refire on swap (v0.1.80)

The seek logic in the `loadedmetadata` listener runs only on fresh loads. For swaps we register a one-shot `Hls.Events.MANIFEST_LOADED` handler that does the same seek — fires per `loadSource` regardless of fresh/swap.

### `video.currentTime` survives swap (v0.1.83)

After `loadSource(newUrl)`, `video.currentTime` keeps its prior absolute value. For server-seek swaps the new stream's `t=0` *is* the seek point, so the stale `currentTime` puts playback at `seekPoint + oldCurrentTime` of source — way off. Fix: the `MANIFEST_LOADED` swap handler now **unconditionally** sets `video.currentTime = seekToMs / 1000` on every swap. For server-seek that's 0 (aligns with new MSE start); for client-seek it's the absolute source position.

**Mobile** (`expo-video`) remounts the player via `playerKey++` per swap — fresh player, fresh `currentTime`. No workaround needed.

**Roku** (`Video` node) resets `Video.content` per swap. Same.

---

## Reference: which Emby user setting trips us up

`SubtitleMode: "Smart"` (Emby default) — server-side auto-pick that overrides `SubtitleStreamIndex=-1` alone. Always pair with `SubtitleMethod=External` when off (see above).

Read user config to verify: `GET /Users/{uid}?api_key={key}` and inspect `Configuration.SubtitleMode`.

---

## Version history (TL;DR)

| Version | Fix |
|---|---|
| v0.1.62 | Force `EnableDirectPlay=false` so params take effect |
| v0.1.64 | Full DeviceProfile (TranscodingProfiles + SubtitleProfiles) |
| v0.1.65 | Pass selectors on POST query; use Jellyfin's TranscodingUrl |
| v0.1.67 | Image-sub StartTimeTicks workaround; echoed Jellyfin session id; UserData write on stop |
| v0.1.68 | `clientSeekMs` field for client-side seek; broader image-sub detection |
| v0.1.69 | Web periodic progress reporter |
| v0.1.70 | Strip `${source}-` prefix from itemId; reliable position capture via timeupdate ref |
| v0.1.73-v0.1.74 | Broaden DirectPlayProfiles for Emby 4.9.x NoCompatibleStream (defensive, not the actual fix) |
| v0.1.75 | **Drop MediaSourceId from query** — root cause of NoCompatibleStream |
| v0.1.76 | Emby uses constructed URL, not TranscodingUrl |
| v0.1.78 | `SubtitleMethod=External` for off |
| v0.1.79 | Delete `StartTimeTicks` from streamParams when shouldDrop |
| v0.1.80 | subtitles[].selected mirrors request; swap-time MANIFEST_LOADED seek |
| v0.1.81 | Drop StartTimeTicks on Emby for any sub-burn |
| v0.1.82 | Explicit `VideoBitrate` / `AudioBitrate` for actual quality control |
| v0.1.83 | Reset `video.currentTime` unconditionally on every swap |
