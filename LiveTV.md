# Live TV — implementation plan

Adding live-channel browsing + playback to WhatsOn. Two source paths,
unified behind one UI:

1. **Direct tuner support** (Phase 1) — talk to network tuners
   (HDHomeRun first, M3U/IPTV later) without depending on a media
   server. Self-sufficient for users with a tuner.
2. **Media-server Live TV** (Phase 2) — surface the user's existing
   Plex DVR / Jellyfin Live TV / Emby Live TV setup. Lets users with
   Plex Pass / Emby Premiere / Jellyfin reuse the lineup + transcoder
   they've already configured.

Both paths converge at the same client-side UI (Live TV tab → channel
grid → player). The aggregator unions channels across every configured
source — Phase 1 with just an HDHomeRun gets you a working channel
grid; Phase 2 plugs Plex/Jellyfin/Emby channels into the same shelf.

**DVR (recording, scheduled timers) is out of scope** for both phases.
Users who want DVR keep that on Plex/Jellyfin/Emby directly. Could be
added in a Phase 3, but it's a separate ~2-week build.

---

## Shared architecture

### `LiveChannel` shape

Every source emits the same shape. The aggregator unions across them.

```ts
export interface LiveChannel {
  /** Source-prefixed channel id, e.g. "hdhr-5.1", "jellyfin-abc123" */
  id: string;
  /** Source tag: "hdhr" | "plex" | "jellyfin" | "emby" | "m3u" */
  source: string;
  /** Display name, e.g. "WCBS-DT" */
  name: string;
  /** Channel number as a string, e.g. "5.1", "504" */
  number?: string;
  /** Network call sign, often the same as name */
  callSign?: string;
  /** Proxied artwork URL (logo). Falls back to a generic icon on the client. */
  logoUrl?: string;
  /** True if the source flags the channel as HD */
  hd?: boolean;
  /** True if the source flags the channel as DRM-restricted (can't stream) */
  drm?: boolean;
}

export interface LiveStreamInfo {
  /** Playable URL — MPEG-TS for direct tuner, HLS for media-server / web-proxy */
  url: string;
  /** Container format — "mpeg-ts" | "hls" — drives Roku Video node config */
  format: 'mpeg-ts' | 'hls';
  /** Session id to pass back on stop, if the source needs it */
  sessionId?: string;
  /** Channel info for the player's title overlay */
  channel: LiveChannel;
}
```

### Source dispatch

A new `LiveSource` interface mirrors `MediaServerAdapter` but is
narrower. Each implementation lives in its own file:

```ts
export interface LiveSource {
  kind: 'hdhr' | 'plex' | 'jellyfin' | 'emby' | 'm3u';
  isConfigured(): boolean;
  getChannels(userToken?: string): Promise<LiveChannel[]>;
  getStreamInfo(channelId: string, userToken?: string): Promise<LiveStreamInfo>;
  /** Optional — EPG. Sources without an EPG return []. */
  getProgramsForChannel(channelId: string, lookaheadHours?: number): Promise<LiveProgram[]>;
}
```

Sources register in `services/live/registry.ts`. `getConfiguredLiveSources()`
returns the list of currently-configured ones. `getLiveSourceForChannel(id)`
parses the prefix and routes.

### `LiveProgram` shape (EPG, Phase 1 week 4)

```ts
export interface LiveProgram {
  channelId: string;        // source-prefixed
  startMs: number;          // epoch ms
  endMs: number;
  title: string;
  episodeTitle?: string;    // "S03E04: Pilot"
  description?: string;
  rating?: string;          // "TV-MA"
  thumbUrl?: string;
}
```

### Routes

- `GET /api/live/channels?source={hdhr|plex|jellyfin|emby|all}` — union
  across configured sources (or filter to one). Source-prefixed IDs so
  the stream endpoint can dispatch.
- `GET /api/live/stream/:channelId?source=...` — returns
  `LiveStreamInfo`. The URL field is what the player tunes to.
- `GET /api/live/epg?channelIds=a,b,c&hours=12` — batch EPG fetch for a
  set of channels (used to populate "now / next" on the channel grid).

---

## Phase 1 — Direct HDHomeRun

### Why HDHomeRun first

Silicondust's HDHomeRun is the de-facto network tuner. Its HTTP API is
open, documented, free, and trivially testable from any LAN. Users who
own one don't need a media server — WhatsOn becomes the front door for
their OTA channels.

### HDHomeRun protocol details

- **Discovery (local)**: `GET http://{tuner-ip}/discover.json` returns
  `{ FriendlyName, ModelNumber, DeviceID, TunerCount, LineupURL, BaseURL,
  DeviceAuth, ... }`. The `DeviceAuth` token is what unlocks the cloud
  guide.
- **Discovery (cloud, fallback)**: `GET https://api.hdhomerun.com/discover`
  returns devices on the user's network (from Silicondust's
  perspective) — useful if local IP discovery via UDP broadcast is
  blocked by network config.
- **Lineup**: `GET {LineupURL}` (typically
  `http://{tuner-ip}/lineup.json`) returns an array of channels:
  ```json
  { "GuideNumber": "5.1", "GuideName": "WCBS-DT",
    "URL": "http://192.168.1.50:5004/auto/v5.1",
    "HD": 1, "Favorite": 1, "DRM": 0,
    "VideoCodec": "MPEG2", "AudioCodec": "AC3" }
  ```
- **Stream**: `GET {URL}` returns an open MPEG-TS HTTP stream. Continues
  until the client disconnects. One tuner per active stream.
- **EPG**: `GET https://api.hdhomerun.com/api/guide.php?DeviceAuth=...`
  returns ~36 hours of programming per channel. Free, no subscription.

### MPEG-TS playback by platform

- **Roku Video node** — supports MPEG-TS over HTTP natively
  (`streamFormat="mpeg-ts"`). No transcoding needed.
- **expo-video on iOS / tvOS** — AVPlayer handles MPEG-TS natively.
- **expo-video on Android** — ExoPlayer handles MPEG-TS natively.
- **Browsers (web)** — NO native MPEG-TS support. Need an HLS proxy
  on the backend that transmuxes MPEG-TS → HLS. ffmpeg does this with
  `-c copy -f hls` (no re-encoding, just repackaging). This is the
  only heavyweight backend addition for HDHomeRun support.

### Backend changes for Phase 1

#### `packages/api/src/services/live/hdhomerun.ts` (new)

- `discover()`: try local IP from config; on failure try cloud
  `/discover`; cache the resolved `BaseURL` + `DeviceAuth` for 1 hour.
- `getChannels()`: fetch lineup, drop DRM-flagged channels (we can't
  stream them anyway), prefix IDs with `hdhr-`, build `LiveChannel`
  array.
- `getStreamInfo(channelId)`: strip the `hdhr-` prefix, return the
  HDHomeRun stream URL with `format: 'mpeg-ts'`. No session bookkeeping
  needed — HDHomeRun streams are stateless from our perspective.
- `getProgramsForChannel(channelId, hours)`: fetch from cloud guide,
  parse into `LiveProgram[]`. Cache 10 min.

#### `packages/api/src/services/live/registry.ts` (new)

- Registers `hdhomerunSource` (Phase 1) and stubs for plex / jellyfin
  / emby (Phase 2).
- `getConfiguredLiveSources()` walks the registry, returns sources that
  pass `isConfigured()`.
- `getLiveSourceForChannel(id)` parses prefix → returns the source.

#### `packages/api/src/services/live/hlsProxy.ts` (new, week 3)

- On `GET /api/live/stream/:channelId` for a `hdhr-` channel from a
  browser User-Agent, spawn ffmpeg as a child process:
  ```
  ffmpeg -i {hdhr-stream-url} -c copy -f hls -hls_time 4
    -hls_list_size 6 -hls_flags delete_segments
    {data-dir}/livetv-hls/{sessionId}.m3u8
  ```
- Return `{ url: '/api/live/hls/{sessionId}/index.m3u8', format: 'hls' }`
  to the client.
- Reap idle ffmpeg processes after ~2 min with no segment requests.
- ffmpeg binary auto-detect: try `ffmpeg` in PATH; on failure, prompt
  the admin to install (or auto-download from gyan.dev /
  ffmpeg-static if we want).

#### `packages/api/src/routes/live.ts` (existing, extended)

Currently TVmaze-only. Add:

- `GET /api/live/channels?source=...&filter=...`
- `GET /api/live/stream/:channelId` — picks proxy vs direct based on
  the requesting User-Agent (Roku/iOS/Android = direct MPEG-TS;
  browser = HLS proxy).
- `GET /api/live/hls/:sessionId/:file` — serves the ffmpeg-generated
  HLS segments (only used for browser playback).
- `GET /api/live/epg?channelIds=...`

#### `packages/api/src/config.ts` (new fields)

```ts
hdhomerun: {
  url: string;        // e.g. http://192.168.1.50
  deviceAuth: string; // populated from /discover.json or manual
  enabled: boolean;
}
```

#### `/setup` UI (Phase 1, sidebar gets a new section)

New section between Emby and Sonarr: **Tuners**. Fields:
- Toggle: "Enable HDHomeRun"
- IP / hostname (with a "Discover on network" button that does the
  cloud discovery and pre-fills)
- DeviceAuth (populated automatically when IP is set + Test passes)
- Status dot + channel count after Test

### Client changes (shared between Phase 1 and Phase 2)

#### Mobile (`apps/mobile`)

- New tab: `app/(tabs)/live.tsx` — channel grid (FlatList of cards,
  channel logo + name + number + "now playing" badge once EPG ships).
- `apps/mobile/lib/api.ts` — `getLiveChannels()`, `getLiveStreamInfo()`,
  `getLiveEpg()`.
- `app/player.tsx`:
  - Accept new param `liveChannelId`. When present:
    - Fetch from `/api/live/stream/:id` instead of `/api/playback/:id`
    - Switch player.streamFormat hint based on `LiveStreamInfo.format`
    - Hide scrub bar, duration, "fromStart" / "resume" prompts
    - Skip the 10s `/playback/progress` polling
    - Don't call `/playback/stop` on exit (live has no session for us
      to clean up; HDHomeRun reaps on client disconnect)

#### Web (`apps/web`)

- New page `src/pages/LiveTV.tsx` — same shape as mobile.
- `src/lib/api.ts` — matching helpers.
- `src/components/VideoPlayer.tsx`:
  - New `liveChannelId` prop
  - Stream URL always comes back as HLS (the proxy did the transmux)
  - Same gating as mobile (no scrub, no progress reporting)
- New nav entry in `src/components/TopBar.tsx`.

#### Roku (`apps/roku`)

- New view `liveTvView` in `HomeScene.xml` with a channel `MarkupGrid`
  using `LiveChannelItem` (new cell component: square logo + name +
  number under). Or reuse `PosterItem` with a square layout.
- New top-tab entry "Live TV" in the existing tab strip.
- `HomeScene.brs`:
  - `fetchLiveChannels()` / `onLiveChannelsResponse()` to populate.
  - `onLiveChannelSelected()` → calls stream endpoint, swaps to
    playback view with `m.isLive = true`.
  - Existing player code: gate the resume-seek + progress-report on
    `m.isLive`. Set `content.streamFormat = "mpeg-ts"` for HDHomeRun
    streams.

### Phase 1 ship order

1. **Week 1 — Backend HDHomeRun**
   - `services/live/hdhomerun.ts` + `services/live/registry.ts`
   - New routes (`channels`, `stream` direct passthrough)
   - `/setup` Tuners section
   - Test with curl → channels list + stream URL
2. **Week 2 — Mobile + Roku watch-live**
   - Player branches for live mode
   - Mobile Live TV tab
   - Roku Live TV view
   - End-to-end smoke test on Shield
3. **Week 3 — Web HLS transcode proxy**
   - `services/live/hlsProxy.ts` with ffmpeg
   - ffmpeg auto-detect / install path
   - Stream endpoint dispatches direct-vs-HLS by User-Agent
   - Web Live TV page
4. **Week 4 — EPG**
   - HDHomeRun cloud-guide fetch + cache
   - `/api/live/epg` endpoint
   - "Now playing" / "next up" badges on channel cards
   - Optional: full EPG grid view

You can stop after week 2 and have a working live-TV experience on
Shield + iOS with no transcoding work. Web and EPG are independent
add-ons.

---

## Phase 2 — Media-server Live TV (Plex / Jellyfin / Emby)

Once Phase 1 lands, the channel grid + player code are shared. Phase 2
is purely backend work: implement the same `LiveSource` interface for
each media server, register them, and they appear on the same grid.

### Why bother with Phase 2 at all

- Users with Plex Pass / Emby Premiere have already configured their
  tuner (often the same HDHomeRun) inside Plex/Jellyfin/Emby. Their
  channel logos, favourites, and EPG metadata are curated there.
- Plex's transcoder handles bandwidth-adaptive HLS well — a remote
  user can watch live over plex.tv relay without exposing HDHomeRun.
- Jellyfin Live TV is free; for Jellyfin-only households without a
  HDHomeRun (e.g. M3U/IPTV users), this is the only path.

### API surfaces per server

| Server | Channel list | Stream URL | EPG | Auth gate |
|---|---|---|---|---|
| Jellyfin | `GET /LiveTv/Channels?UserId=...` | `GET /Items/{channelId}/PlaybackInfo` (returns transcoded HLS) | `GET /LiveTv/Programs` | Free |
| Emby | Same endpoints as Jellyfin (it's a 3.5.x fork) | Same | Same | Emby Premiere |
| Plex | `GET /livetv/dvrs/{dvrId}/devices/{deviceId}/channels` after `GET /livetv/dvrs` | `GET /video/:/transcode/universal/start.m3u8?path=...` | `GET /media/grabbers/guides/...` | Plex Pass |

Jellyfin + Emby will share most of the implementation via the existing
`embyLike.ts` factory — the same way VOD already does.

Plex is a separate implementation; its Live TV API is undocumented but
well reverse-engineered. Feature-flag the entire Plex live-TV path on
DVR discovery so a misconfigured Plex doesn't break VOD.

### Phase 2 backend changes

- `services/live/jellyfin.ts` — implements `LiveSource` against
  Jellyfin's `/LiveTv/*` endpoints. Reuses `embyLike.ts` patterns where
  possible.
- `services/live/emby.ts` — thin wrapper over `jellyfin.ts` with the
  Emby-specific auth quirks.
- `services/live/plex.ts` — separate impl. DVR discovery, channel
  enumeration, transcode session start.
- `registry.ts` — register the three new sources.

### Phase 2 client changes

**None — the UI is already built.** The channel grid unions across
sources via `/api/live/channels?source=all`. The player branches on
`LiveStreamInfo.format` which Plex/Jellyfin/Emby all return as `hls`.
No new UI work.

The only optional UI tweak: a small source-badge on each channel card
(matching how we badge library content) so users can see which server
the channel is coming from. Useful if a user has both HDHomeRun and
Plex DVR configured with the same physical tuner — duplicate channels
would appear, and the badge disambiguates.

### Phase 2 ship order

1. Jellyfin live source (~3 days)
2. Emby live source — mostly copy from Jellyfin (~1 day)
3. Plex live source (~5 days — the hard one)

Total Phase 2: ~2 weeks.

---

## Effort summary

| Phase | Scope | Effort |
|---|---|---|
| Phase 1 weeks 1–2 | HDHomeRun watch-live on mobile + Roku (no transcoding) | 2 weeks |
| Phase 1 week 3 | Web HLS transcode proxy | 1 week |
| Phase 1 week 4 | HDHomeRun EPG | 1 week |
| Phase 2 | Jellyfin + Emby + Plex live sources | 2 weeks |
| Phase 3 (deferred) | DVR (recording, timers, file management) | 2–3 weeks |

**Total for the user's currently-scoped plan (HDHomeRun primary +
media-server fallbacks, no DVR): ~6 weeks** of focused work across
backend + mobile + web + Roku.

Realistic incremental milestones:
- After week 2: watch HDHomeRun on Shield + iOS
- After week 3: + web
- After week 4: + EPG
- After week 6: + Plex/Jellyfin/Emby live channels in the same grid

---

## Open questions

### 1. ffmpeg dependency

Web requires ffmpeg on the backend for MPEG-TS → HLS transmux.
Options:

- **Auto-download on first use** (cleanest UX) — fetch a static
  ffmpeg binary from a known mirror (gyan.dev for Windows,
  ffmpeg-static npm package). Adds a one-time 70MB download.
- **Bundle in the installer** — adds 70MB to every backend release.
  Heavy but reliable.
- **Require manual install** — admin installs ffmpeg system-wide,
  WhatsOn looks it up in PATH. Lightest, but bumps friction.

**Lean:** auto-download on first use. The admin sees a one-time
"installing ffmpeg…" status on the /setup page.

### 2. Concurrent stream limit

HDHomeRun has a fixed tuner count (typically 2–4). If two clients try
to watch different channels at once and you only have a 2-tuner
device, the third client's request will fail at the HDHomeRun level.

Should the backend track in-flight live sessions and surface a "no
free tuners" error proactively, or let it fail naturally? **Lean:**
let it fail naturally for v1, surface a friendlier error if it
becomes an issue.

### 3. Tab vs shelf

Same question as the original LiveTV.md — does Live TV deserve a
top-level tab? Already 6 tabs on phone.

**Lean:** yes, new "Live TV" tab. Sports tab stays focused on sports;
the TVmaze-driven "What's On" shelf inside Sports can stay (different
content, doesn't conflict).

### 4. Channel grouping

If the user has BOTH HDHomeRun AND Plex DVR pointing at the same
physical tuner, duplicate channels will appear. Options:

- **Show duplicates** with source badges — user picks
- **Auto-dedup** by callsign + number, prefer one source
- **Source filter pill strip** — All / HDHomeRun / Plex / Jellyfin /
  Emby (matches the Library tab pattern)

**Lean:** source filter pills (already a familiar pattern), plus
small source badges on each card. No auto-dedup — users may have
intentional reasons to prefer one source over another for a given
channel.

### 5. Direct vs proxy detection

The stream endpoint switches between direct MPEG-TS (Roku/mobile) and
HLS proxy (web) based on User-Agent. That's fragile.

Alternative: client explicitly requests format via
`/api/live/stream/:id?format=mpeg-ts|hls`. Roku/mobile pass
`?format=mpeg-ts`; web passes `?format=hls`. **Lean:** explicit
format param — more reliable than UA sniffing.

---

## Risks

- **HDHomeRun firmware drift** — Silicondust occasionally changes the
  lineup.json schema between firmware revs. We pin to current fields
  (`GuideNumber`, `GuideName`, `URL`, etc.) and add new fields
  defensively.
- **ffmpeg startup cost** — first segment ready in ~2 seconds when
  ffmpeg cold-starts. Users may interpret as a stall. Show a
  "Tuning to {channel}…" spinner for the first segment.
- **Plex Live TV API drift** (Phase 2) — undocumented, can break
  between Plex versions. Mitigation: feature-flag on DVR discovery
  so failures degrade to "no channels from Plex" rather than crash.
- **EPG quality** — Silicondust's free guide covers most US OTA
  channels well, but has spotty data for low-power / specialty
  channels. Phase 1 ships with whatever the cloud returns; later
  phases could add XMLTV fallback.
- **No DVR is a real gap** — power users who want to record will be
  disappointed. We say loud and clear "use Plex/Jellyfin/Emby DVR
  for that" in the /setup Tuners help text.

---

## Decision points before implementation starts

- [ ] Tab vs shelf placement (default: new tab)
- [ ] Source filter pills + small badges, no auto-dedup (default: yes)
- [ ] Explicit `?format=` param vs User-Agent sniffing (default: explicit)
- [ ] ffmpeg auto-download vs manual install (default: auto-download)
- [ ] Confirm: Phase 1 ships HDHomeRun-only, Phase 2 adds media-server
      sources later. We do NOT block Phase 1 on Phase 2 readiness.
