# Live TV — implementation plan

Adding live-channel browsing + playback to WhatsOn, backed by the user's
existing media server's tuner integration (Plex DVR / Jellyfin Live TV /
Emby Live TV). Direct-HDHomeRun support is **not** in scope here — that
would mean owning EPG ingestion, transcoding policy, and channel logos,
which the media servers already solve.

The plan is broken into three phases so we can ship usefully without
committing to the full build. Phase 1 alone gives a working
"click a channel, it plays" experience; Phases 2 and 3 are decided
separately after a week of using Phase 1.

---

## Phase 1 — Watch Live (this plan)

### In scope

- Channel list per configured library server (Plex, Jellyfin, Emby)
- New "Live TV" page on mobile + web + Roku — channel grid with logos
- Tap a channel → playback (HLS via the existing player)
- Channel logos proxied through `/api/artwork`
- Source-prefixed channel IDs so we can union across servers safely

### Out of scope (Phase 2+)

- EPG (now / next program per channel)
- Recordings list / "DVR" tab
- Schedule a recording from the EPG
- Live-stream quality switching (use sane server defaults for v1)
- Last-watched channel / favourites
- Replacing the existing TVmaze-driven "What's On" experience

---

## API surfaces per server

| Server | Channel list | Stream URL | Auth gate |
|---|---|---|---|
| Jellyfin | `GET /LiveTv/Channels?UserId=...` | `GET /Items/{channelId}/PlaybackInfo` (same shape as VOD) | Free |
| Emby | Same endpoints as Jellyfin (it's a 3.5.x fork) | Same | Emby Premiere |
| Plex | `GET /livetv/dvrs/{dvrId}/devices/{deviceId}/channels` after discovering DVR via `GET /livetv/dvrs` | `GET /video/:/transcode/universal/start.m3u8?path=...` (transcode session) | Plex Pass |

Jellyfin + Emby will share most of the implementation via the existing
`embyLike.ts` factory — the same way VOD already does. Plex is a separate
implementation; its Live TV API is undocumented but well reverse-engineered.

### Stream format

All three return HLS playlist URLs. The existing player code paths handle
HLS already — no new decoder logic needed.

### Live-stream quirks vs. VOD

- **No duration** — `duration` is `0` / unknown. Players must hide the
  scrub bar, percent-played, time-remaining UI.
- **No resume** — playback always starts "now"; no `offset` / `viewOffset`
  / `clientSeekMs`.
- **No progress reporting** — skip the 10-second `/playback/progress`
  polling.
- **No "mark watched"** — hide the option in DetailSheet for live items.
- **Channel switch is a teardown + new playback session** — there's no
  cross-channel seek.

---

## Backend changes

### `packages/api/src/services/adapters/types.ts`

Extend the `MediaServerAdapter` interface:

```ts
export interface LiveChannel {
  /** Source-prefixed channel id, e.g. "jellyfin-abc123" */
  id: string;
  /** Display name, e.g. "WCBS-DT" */
  name: string;
  /** Channel number as a string, e.g. "2.1" or "504" */
  number?: string;
  /** Network call sign, often the same as name */
  callSign?: string;
  /** Proxied artwork URL (logo). Falls back to a generic icon on the client. */
  logoUrl?: string;
}

export interface MediaServerAdapter {
  // ... existing methods ...

  /**
   * Returns the live channels available on this media server. Returns
   * an empty array (not an error) when Live TV isn't configured on
   * the server — so the home page degrades gracefully for users
   * without a tuner.
   */
  getLiveChannels(userToken?: string): Promise<LiveChannel[]>;

  /**
   * Get a playable HLS stream for a single channel. Re-uses the
   * existing PlaybackInfo response shape so the client player code
   * stays unchanged.
   */
  getLiveStreamInfo(
    channelId: string,
    opts?: { maxBitrate?: number },
    userToken?: string,
  ): Promise<PlaybackInfo>;
}
```

### `packages/api/src/services/embyLike.ts`

Add the two methods to the factory. Both adapters (`jellyfin.ts` and
`emby.ts`) inherit them.

- `getLiveChannels`: hit `/LiveTv/Channels?UserId={s.userId}&Fields=PrimaryImageAspectRatio,ChannelInfo`,
  map each item to `LiveChannel`. Logo via `/Items/{id}/Images/Primary`,
  proxied through `/api/artwork`.
- `getLiveStreamInfo`: hit `/Items/{channelId}/PlaybackInfo` with the
  same DeviceProfile JSON we already construct for VOD. The response
  shape is identical to VOD's — `streamUrl`, `sessionId`, `duration` (will
  be 0), and empty `subtitles`/`audioTracks`.

### `packages/api/src/services/plex.ts`

Plex needs DVR discovery first because channels live under a DVR, which
lives under a device:

1. `GET /livetv/dvrs` → array of DVR objects with `key` (id) and
   `Device` array.
2. For each device: `GET /livetv/dvrs/{dvrId}/devices/{deviceId}/channels` →
   channel objects.
3. To stream: `GET /video/:/transcode/universal/start.m3u8?path=server%3A%2F%2F{dvrId}%2Fcom.plexapp.plugins.library%2Flivetv%2Fdvrs%2F{dvrId}%2Fchannels%2F{channelId}%2Fstream&...` —
   exact param set will need probing against a real Plex Pass account.

If `/livetv/dvrs` returns empty (no Plex Pass / no DVR), `getLiveChannels`
returns `[]`. Feature-flag the entire Plex live-TV path on the DVR
discovery result so a misconfigured Plex doesn't break VOD.

### `packages/api/src/routes/live.ts`

Currently exposes only the TVmaze-driven channels. Add two new endpoints:

- `GET /api/live/library-channels?source={plex|jellyfin|emby|all}` —
  union across configured adapters. Source-prefixed IDs (`jellyfin-abc`,
  `plex-123`, etc.) so the client can pass the ID straight to the stream
  endpoint without ambiguity.
- `GET /api/live/library-stream/:channelId?source=...` — returns the same
  `PlaybackInfo` shape as `/api/playback/:ratingKey`. Source is encoded in
  the prefix, so the route can dispatch via `getAdapterForSource()`
  without re-parsing.

### `packages/api/src/services/aggregator.ts`

Optional: surface live channels on the home page via a "Live TV" shelf
that lists ALL configured channels (or just the first N). Probably not
in Phase 1 — the dedicated Live TV page is enough. Add later if useful.

---

## Client changes

### Mobile (`apps/mobile`)

- New file `apps/mobile/app/live-tv.tsx` — channel grid view, FlatList of
  channel cards (logo + name + number).
- New tab in `apps/mobile/app/(tabs)/_layout.tsx` — "Live TV" between
  Movies and Library. (Could also fold into Sports → "Sports & Live"
  but new tab keeps it discoverable.)
- `apps/mobile/lib/api.ts` — `getLibraryChannels()` + `getLibraryStreamInfo()`.
- `apps/mobile/app/player.tsx` — accept new param `liveChannelId`. When
  present:
  - Skip the resume-position seek
  - Hide scrub bar + duration label
  - Skip the 10s `/playback/progress` polling
  - Pass the stream info from the new endpoint instead of `/api/playback`

### Web (`apps/web`)

- New `apps/web/src/pages/LiveTV.tsx` — channel grid. Same shape as
  mobile, share fetch contracts.
- New nav entry in `apps/web/src/components/TopBar.tsx`.
- `apps/web/src/lib/api.ts` — matching helpers.
- `apps/web/src/components/VideoPlayer.tsx` — new `liveChannelId` prop,
  same gating as mobile.

### Roku (`apps/roku`)

- New view inside `HomeScene.xml`: `liveTvView` with a channel
  `MarkupGrid` using a new `LiveChannelItem` cell renderer (or reuse
  `PosterItem` with `itemSource="live-channel"` and a square layout).
- New top tab entry "Live TV" in the existing tab strip.
- `HomeScene.brs`:
  - `fetchLiveChannels` / `onLiveChannelsResponse` to populate the grid.
  - `onLiveChannelSelected` → call the new stream endpoint, swap to
    playback view.
  - Existing player code path: gate the resume-seek + progress-report on
    a new `m.isLive = true` flag.

---

## Order of work

Each step is independently testable. Stop after any of them if it
turns out we don't want the rest.

1. **Adapter interface + Jellyfin impl + new routes** — backend-only,
   hit with curl from `/setup` → tail logs. Confirms the channel-listing
   shape and the HLS URL we'd get.
2. **Mobile Live TV page** — end-to-end smoke test on the Shield. Tells
   us if the live-stream flow plays cleanly through the existing player
   with the new gating in place.
3. **Emby impl** — mostly copy-paste from the Jellyfin path; only the
   auth-header / API-version quirks already encoded in `embyLike.ts`
   should differ.
4. **Web page** — same shape as mobile; the player branching is the
   only new web work.
5. **Plex impl** — last because it's the messiest. DVR discovery, channel
   listing, transcode session start. Will require probing against a real
   Plex Pass account.
6. **Roku view** — heaviest UI work; benefits from the others being
   settled so the contract is locked.

---

## Open questions

### 1. Tab vs shelf

A new top-level "Live TV" tab is the clearest entry point, but:
- It adds a 6th tab (already crowded on phone).
- The existing Sports tab already includes a TVmaze-driven "What's On"
  shelf — there's some conceptual overlap.

**Lean:** new top-level "Live TV" tab. Sports stays focused on
sports-specific surfaces. Drop the TVmaze "What's On" shelf from Sports
in Phase 2 if the new Live TV page subsumes it.

### 2. One shelf vs one per source

If you have all three servers configured with Live TV, the channel grid
could show:
- (A) **One unified grid** sorted by channel number — clean, fewer scrolls.
- (B) **One shelf per source** — clearer where each channel is coming
  from, but more vertical space.

**Lean:** (A) one unified grid with a small source badge on each card,
matching how we treat library content. Optional source filter pill
strip at the top (matches Library tab's "All / Plex / Jellyfin / Emby").

### 3. Channel logos

All three servers expose channel logos. Some are SD raster
(low-resolution PNGs of network logos), some are HD. We'll need a
fallback for missing logos — probably a Unicode `📺` glyph or the
channel name in a styled tile.

### 4. Plex DVR discovery cost

`GET /livetv/dvrs` is a one-shot call but it adds startup latency to
the Live TV page if we do it every fetch. Cache the DVR + device list
for ~10 min (same TTL as library), only re-discover on config change.

### 5. Roku transport overlay during live

Roku's `enableUI=true` transport bar shows a progress indicator. With
duration=0 it'll just sit at 0%. Need to test whether it looks broken
or if Roku gracefully hides duration UI for live streams. If broken,
we may need to flip `enableUI=false` for live and render our own minimal
overlay (just title + back).

---

## Risks

- **Plex Live TV API drift** — undocumented, can change between Plex
  versions. We pin our behaviour to specific endpoints reverse-engineered
  from current Plex; future Plex updates might break it. Mitigation:
  feature-flag the Plex live path on DVR discovery so failures degrade
  to "no channels from Plex" rather than a crashed page.
- **Transcoding load** — live HLS sessions are expensive on the server.
  Watching live for hours could thrash the Plex/Jellyfin transcoder. Not
  WhatsOn's problem strictly, but users may complain. We could expose a
  "direct stream" flag in a future phase.
- **No EPG in Phase 1** means channels appear as bare logos / numbers
  with no "what's on right now" context. Acceptable for v1 but limits
  the discovery value of the screen.

---

## Effort estimate

- Phase 1 alone: **~1 week** of focused work across all four codebases.
- Adding Phase 2 (EPG): **+3 days**.
- Adding Phase 3 (DVR — recordings + scheduled timers): **+1 week**.

Total for full parity across all three servers: ~2 weeks.

---

## Decision points

If anything below stays "unknown" after the user reads this, list it
back and the implementation pauses until it's answered:

- [ ] Tab vs shelf placement (default: new tab)
- [ ] Unified grid vs per-source shelves (default: unified)
- [ ] Drop TVmaze "What's On" from Sports tab once Live TV ships? (default: leave it for now)
- [ ] Build all three sources in Phase 1, or ship Jellyfin first and add
      Plex+Emby in follow-ups? (default: Jellyfin → Mobile → Web → Emby →
      Plex → Roku as listed above)
