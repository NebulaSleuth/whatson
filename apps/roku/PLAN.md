# Whats On — Roku Channel Plan

This document is the architecture and delivery plan for the Roku client. It assumes the existing `packages/api` backend is unchanged and that the React Native phone/TV codebase under `apps/mobile` is the reference UX. The Roku build is **not** a port — it's a clean-slate channel in BrightScript and SceneGraph that talks to the same HTTP API.

> **STATUS (2026-09-06): Phases 0–3 shipped; store submission (Phase 4) not started.**
> The channel is live (sideloaded) on two devices and implements: Home shelves, TV,
> Movies, **Live TV** (now + later via `/api/live/*`), Sports, Library, Search, Settings —
> **8 tabs** (§7's original 7-tab list predates Live TV). Detail view with Play / Resume /
> Mark (All) Watched/Unwatched / Add to Sonarr/Radarr / Track / **Go to Show**
> (seasons+episodes browser), HLS player, Plex **and** unified Whats-On user accounts with
> per-device auth-key pairing, avatars and Switch User, plus the v0.1.145/146 features:
> **download status panel with Cancel Download / Cancel & Re-search**, **Search Now**, and
> the **LATE** badge.
>
> **Shipped in code, compile UNVERIFIED — needs a sideload + on-device pass** (written
> without a Roku or BrightScript compiler reachable; see the "verify on device" list below):
> - **"Sign in with Whats On"** (cloud device-code onboarding) on the pair view →
>   `cloudSignInView`; POST `https://cloud.whatsontv.net/api/device-code`, poll
>   `/api/device-code/poll`, probe the grant's connection candidates, POST
>   `<winner>/api/auth/redeem-grant`, persist key + URL like the LAN pair flow. Plus
>   **connection candidates**: `GET /api/candidates` cached after a LAN pair (registry
>   `candidates` / `expectedServerId`), and at boot an unreachable `apiUrl` falls back
>   to probing the cached candidates before showing a "Can't reach your server" pair
>   state. The pair view now has mobile's action row (New code / Edit server URL /
>   Sign in with Whats On) and a no-URL "Connect to your server" state.
> - **Guest self-serve profile**: "New" tile on the Whats On picker → `createProfileView`
>   (name via KeyboardDialog + avatar grid from `/api/whatson-users/avatars`) → POST
>   `/api/whatson-users/guest-profile` → auto-select.
> - **Sports league + team follows**: Settings → Sports is now leagues (left) + teams
>   (right, `/api/sports/teams?league=`) with an "All games" mode row; PUTs the full
>   `SportsPrefs` shape. **Sports tab is hidden until a league is followed** (mobile
>   `_layout.tsx` parity) — the TabButton is detached from the strip and re-inserted.
> - **Sonarr/Radarr add picker** (`arrPickerView`): Quality Profile / Root Folder /
>   Monitor (Sonarr: "All Episodes" = `all`, "Future Only" = `future`) with last-used
>   memory in the registry (`sonarrProfile`, `sonarrFolder`, `sonarrMonitor`,
>   `radarrProfile`, `radarrFolder`); Sonarr adds send `monitor` + `searchForMissing: true`.
> - **PIN session token**: `data.sessionToken` from POST `/whatson-users/:id/select` is
>   kept (registry `whatsonSession`, alongside the remembered user) and sent as
>   `X-Whatson-Session` by `ApiTask`; cleared on Switch User / Unpair / Re-pair / a
>   rejected auth key / falling back to the Plex picker.
>
> Verify on device: BrightScript compile of `HomeScene.brs` (~8,800 lines) + `ApiTask`;
> `LayoutGroup.insertChild/removeChild` re-flow of the tab strip and pair/cloud button
> rows; LabelList bottom-boundary Down bubbling to the Scene (arr picker → Add row);
> `roUrlTransfer` HTTPS to cloud.whatsontv.net (cert bundle); `Timer.duration` from the
> cloud's `interval`; MarkupGrid `numRows=1` avatar grid; that `/api/whatson-users/
> guest-profile` 403s on an owner-role device exactly as it does on mobile.
>
> **Where the plan diverged from the build** (kept for the record; the sections below
> describe the original plan):
> - §4's multi-scene layout was **not** followed — the shipped channel is a single
>   mega-scene (`components/HomeScene.brs`, ~8,800 lines) holding all tabs, detail,
>   player, and settings logic, with flat leaf components (ActionButton, ApiTask,
>   EpisodeListItem, LiveChannelItem, PosterItem, SportsCard, TabButton, ToggleRow,
>   UserCardItem). No `util/`/`tasks/`/`cards/` dirs; `PosterItem` fills `ContentCard`'s
>   role. A future refactor into scenes is optional, not planned.
> - Manifest `title` is `What's On TV` (not `Whats On`), plus `confirm_partner_button=1`
>   and `bs_const=DEBUG=true`.
> - Auth went beyond §7's Plex-only design: per-device auth keys (`configAuthKey()` /
>   `ROKU_AUTH_KEY`, registry-first), `/api/whatson-users/*`, "Remember login".
>
> **Recorded parity divergences (per §1's commitment):**
> - Detail summary is capped at **4 lines instead of 6** whenever a download/search
>   status panel is visible, so the status line at y≈650 doesn't overlap the summary
>   (`HomeScene.brs` `populateDetail`). Mobile shows the full summary.
> - Contextual action buttons (download-cancel, search-now) live in their **own
>   LayoutGroups** (`downloadActions`, `searchActions`) because SceneGraph LayoutGroups
>   reserve space for invisible children — mixing them into the main action row pushed
>   buttons off-screen.
> - **Connection candidates are probed sequentially**, not raced. Mobile's
>   `connectionRace.ts` fires every candidate at once (LAN gets a 250 ms head start, 2 s
>   timeout each). A BrightScript `Task` runs one `roUrlTransfer` per node, so Roku walks
>   the list in priority order (lan → ipv6 → wan → relay) with a 4 s timeout per
>   candidate (`startCandidateProbe` / `probeNextCandidate`). Same right-server check
>   (`/api/health` `serverId` must match `expectedServerId` when both exist). Worst case
>   is `4 s × candidates` before "Can't reach your server" instead of ~2.75 s.
> - **Boot fallback shows a pair-view state, not a status.** Mobile's `resolveConnection`
>   returns `'unreachable'` and the app shows a can't-reach message. Roku reuses the pair
>   view (`m.pairMode = "connecting" | "unreachable"`) with Retry / Edit server URL /
>   Sign in with Whats On, keeping the existing auth key (no re-pair is forced).
> - **Sonarr/Radarr add picker renders options as three vertical LabelList columns**
>   (Quality Profile / Root Folder / Monitor) with an Add / Cancel row beneath, instead of
>   mobile's wrapping chip rows — long root-folder paths don't fit a chip strip on the
>   D-pad, and LabelList is the established Roku idiom here (tracks picker). Values,
>   labels, defaults and remembered-prefs behaviour match `ArrAddPicker.tsx`.
> - **Sports settings save on every toggle** (leagues and teams), whereas mobile stages a
>   draft behind Save/Cancel. Mobile's two mode chips ("Favorite teams (n)" / "All games")
>   become an "All games" row at the top of the team list; picking any team implies
>   "Favorite teams" mode, exactly as mobile switches mode when opening its team picker.
>   Team logos are not shown (LabelList rows are text only).
> - **Create profile shows the selected avatar as a text label** ("Selected: …") rather
>   than a gold border on the chosen tile — `UserCardItem` has no selected state and the
>   MarkupGrid re-renders cells on scroll. Avatar tiles otherwise reuse `UserCardItem`.
> - **Switch User clears the PIN session token** (mobile treats a switch as sign-out);
>   Roku's picker has a Back path mobile lacks, so Back is eaten for a PIN-protected user
>   whose token was just cleared — they must re-select (and re-enter the PIN).
> - **Both pair and cloud flows can be live at once**: pressing "Sign in with Whats On"
>   leaves the LAN pair poll running, so whichever completes first wins (mobile navigates
>   away from the pair screen and stops its poll).
>
> **Known issue:** `scripts/package.js` does not include `fonts/**/*` while
> `scripts/deploy.js` does — a store package would miss NotoSansSymbols.ttf (Settings
> gear glyph). Fix before Phase 4. See `docs/KNOWN-ISSUES.md`.

---

## 1. Goals — Roku must match Android TV / tvOS

**The Android TV and tvOS apps (`com.extrastrength.whatsontv`) are the design reference.**
Every screen, every interaction, every default value the Roku channel ships
should match what the user sees on those builds. When the implementation
forces a divergence (Roku platform constraint, missing SceneGraph primitive),
note the divergence in this plan and treat closing the gap as a follow-up,
not a permanent decision.

Concrete commitments:

- **Feature set** — same tabs (shipped: Home / TV Shows / Movies / Live TV /
  Sports / Library / Search / Settings), same shelves on Home (Continue
  Watching, Ready to Watch — TV/Movies, Coming Soon — TV/Movies, Sports On
  Now / Later, "What's on TV" + "What's on TV Later"), same detail-sheet
  actions (Play/Resume, Mark Watched, Mark Unwatched, Mark All, Add to
  Sonarr/Radarr, Track, Go to Show, and the download-cancel / Search Now
  actions from v0.1.145/146).
- **Defaults** — Library tab opens to TV Shows sorted A-Z; Sports On Later
  shows 7 days; Continue Watching items excluded from Ready to Watch;
  one-card-per-show on TV shelves. Same defaults the mobile aggregator
  produces — no Roku-only divergence.
- **Data flow** — reuse the `:3001` HTTP API verbatim, including the union
  across all configured library servers. Zero backend changes to ship the
  Roku client. Same `X-Plex-User` / `X-Plex-Connection` headers; same
  per-user multi-server behaviour.
- **Look** — gold accent (`#E5A00D`) for focus + brand mark, matching the
  mobile theme. Posters at the same 2:3 aspect ratio. Team-coloured sports
  cards. Live "LIVE" pill with white dot.
- **Playback** — native HLS via Roku's `Video` node, subtitle + audio
  switching, intro/credits skip, position resume, periodic progress
  reporting. Same scrobble flow.
- **Performance** — acceptable on a 2017-era Roku Express
  (lowest-common-denominator target).

## 2. Non-goals (initial release)

- WebSocket-driven live invalidation. We poll instead — see §10.
- Offline mode / on-device caching beyond what SceneGraph already does for posters.
- Cast-from-phone. The mobile app's "Play on Plex client" feature ships with Roku as a target later, not as part of channel v1.
- Channel Store publication. Sideload only for v1; store submission is a separate phase.

---

## 3. Why a clean slate

Roku channels are written in **BrightScript** (Roku's proprietary scripting language) and **SceneGraph** (XML-described UI tree, BrightScript-driven). There is no React Native runtime on Roku and no usable code-sharing path with `apps/mobile`. The reuse is *behavioural* — same screens, same navigation, same API responses — not source-level.

Consequences:
- Two clients to maintain on UX changes. Mitigation: keep the API thick and the clients thin. The mobile client already does this; Roku follows the same pattern.
- Different language. BrightScript is dynamically typed, single-threaded per scene with cooperative async via `Task` nodes. No npm, no JSX. Idioms differ.
- Different rendering model. SceneGraph composes a fixed set of node types (`Label`, `Poster`, `RowList`, `Video`, etc.). Custom widgets are XML components that delegate to a `.brs` script.

---

## 4. Project layout

```
apps/roku/
  manifest                ← Roku channel manifest (entry point)
  package.json            ← npm workspace, dev scripts
  README.md               ← dev quick-start
  PLAN.md                 ← this document

  source/
    main.brs              ← `Sub Main()` entry, creates the screen + scene loop

  components/
    HomeScene.xml/.brs    ← root scene; tab bar + child scenes
    HomeShelves.xml/.brs  ← RowList of Continue Watching / Ready to Watch / etc.
    DetailScene.xml/.brs  ← per-item detail + Play button
    PlayerScene.xml/.brs  ← Video node + transport overlay + subtitle picker
    LibraryScene.xml/.brs ← grid view per source
    SearchScene.xml/.brs  ← combined library + discover search
    SportsScene.xml/.brs  ← sports shelves
    SettingsScene.xml/.brs← API URL, Plex pairing, prefs
    cards/
      ContentCard.xml/.brs ← poster + progress + status pill
      SportsCard.xml/.brs  ← team-colored sports card

    tasks/
      ApiTask.xml/.brs    ← single-shot HTTP GET / POST returning parsed JSON
      ImageProxyTask.xml/.brs ← optional, cached image fetcher for `/api/artwork` URLs

    util/
      Api.brs             ← thin BrightScript wrapper that builds Task nodes
      Headers.brs         ← `X-Plex-User`, `X-Plex-Connection` injection
      Format.brs          ← time / duration / status formatting

  images/
    icon-focus-hd.png     ← 290x218
    icon-focus-sd.png     ← 246x140
    splash-hd.jpg         ← 1280x720
    splash-sd.jpg         ← 720x480

  scripts/
    deploy.js             ← `roku-deploy` sideload to a dev device
    package.js            ← .zip for store submission

  out/                    ← built artifacts (gitignored)
```

Component files come in pairs: `Foo.xml` describes the node tree and interface, `Foo.brs` provides the script (init, observers, helpers). This is idiomatic SceneGraph.

---

## 5. SceneGraph + BrightScript primer

Just enough to make the rest of this document make sense.

- **Threading.** Each `Scene` runs on the *render thread*. Task `Task` nodes run on a separate thread and report results back via observable fields. **Don't do HTTP on the render thread** — it freezes the UI.
- **Observable fields.** A node declares fields on its `<interface>`. `node.observeField("foo", "onFooChanged")` invokes the named function whenever the field changes. This is how Tasks report results and how scenes wire to user input.
- **Focus management.** Every focusable node has `setFocus(true)`. The active focus chain is implicit. D-pad events bubble up from the focused node to ancestors, where you handle `roSGNodeEvent`.
- **Content model.** `RowList`, `MarkupGrid`, etc. consume a `ContentNode` tree. Build the tree, assign it to `node.content`, and SceneGraph re-renders.
- **Component composition.** A custom card (e.g. `ContentCard`) is an XML component with its own `<interface>` (e.g. `posterUrl`, `title`, `progress`). Its `.brs` reacts to interface changes and updates its child nodes accordingly.

---

## 6. HTTP API client

Single pattern — all requests go through `ApiTask`, a `Task`-extending component.

```
                   ┌──────────────────────┐
   Scene calls ────▶│  ApiTask  (thread)   │── roUrlTransfer ──▶ /api/*
                   │  - url                │
                   │  - method             │
                   │  - body               │
                   │  - response (out)     │
                   └──────────────────────┘
                              │
   observeField("response") ◀─┘
   → onResponse() in scene
```

Headers — set on every request via `util/Headers.brs`:
- `X-Plex-User: <userId or empty>`
- `X-Plex-Connection: local | remote` (current state from settings)
- `Accept: application/json`
- `Content-Type: application/json` (when method = POST/PUT)

URL composition lives in `util/Api.brs`:
- `apiHomeUrl()` → `<apiUrl>/api/home`
- `apiSportsNow()` → `<apiUrl>/api/sports/now`
- … one helper per endpoint.

`apiUrl` itself comes from registry-stored settings (see §11). On boot we read it; the Settings scene rewrites it.

Error handling — every Task call returns `{ success: bool, data?: any, error?: string }` matching the API's `ApiResponse<T>` shape. Scenes show an inline error state on `success === false`.

---

## 7. Scene-by-scene plan

### HomeScene
- Tab bar (Home / TV / Movies / Library / Search / Sports / Settings) on top, content below.
- Tabs implemented as a horizontal `LayoutGroup` of `Label`s with manual focus styling (matches the mobile TV approach).
- Active tab swaps the scene's content child.

### HomeShelves (Home tab body)
- Vertical `RowList` of shelves. Each shelf is one `ContentNode` whose children are content cards.
- Sections come from `/api/home`. Sports shelves come from `/api/sports/now` and `/api/sports/later` if `/api/sports/prefs.leagues` is non-empty.
- Re-fetch on focus return (after navigating back from Detail/Player) and every 60 seconds while focused — see §10.

### DetailScene
- Backdrop image, title, summary, metadata, action buttons (Play, Mark Watched, Mark Unwatched, Add to Sonarr/Radarr).
- Play button hits `/api/playback/:ratingKey?source=...` and pushes `PlayerScene` with the response.

### PlayerScene
- `Video` node fullscreen. HLS URL goes into `content.url`.
- Subtitles: SceneGraph supports external SubRip side-loading; if Plex/Jellyfin's transcode burns subtitles in (current behaviour), no extra work.
- Audio tracks: switching requires a re-issue of `/api/playback/:id?audioStreamID=...` and a stream URL replace — `Video.control = "stop"`, set new URL, `control = "play"`. Same approach the mobile player uses.
- Position reporting every 10 seconds: `Video` exposes `position` via observable field; `ApiTask` POSTs `/api/playback/progress`.
- Stop event: POST `/api/playback/stop` and pass the resume position back so backend baking-into-stream-URL works on next launch.

### LibraryScene
- `MarkupGrid` of posters per type (movie or show). Top-of-grid filter chips switch between Plex / Jellyfin / Emby and TV / Movies.
- Drives `/api/library/{type}?source=...`.

### SearchScene
- Mobile keyboard via `KeyboardDialog` (or on-screen keyboard component) — Roku has no good text input.
- Splits results into "My Library" and "Discover & Track" matching mobile.

### SportsScene
- Two `RowList` shelves: "Sports On Now" and "Sports On Later".
- Custom `SportsCard` component renders the team-colored card. Live cards animate the `LIVE` dot.
- Tapping a live card opens a SportsDetail scene polling `/api/sports/event/:id` every 15 s while status=in.

### SettingsScene
- API URL (text input).
- Plex pairing: a 4-digit PIN flow that the user enters on a phone-side helper page or Plex-app's pairing UI. Backend already exposes `/api/config/test` and Plex PIN endpoints — Roku just needs to display the PIN and poll for completion.
- Per-user user-picker (Plex Home users) using `/api/users` + `/api/users/select`.
- Connection type toggle (`local` / `remote`) — written into the registry, read by every API request.

---

## 8. Channel manifest

Required entries (`apps/roku/manifest`):

```
title=Whats On
subtitle=Tonight's media at a glance
major_version=0
minor_version=1
build_version=00000
mm_icon_focus_hd=pkg:/images/icon-focus-hd.png
mm_icon_focus_sd=pkg:/images/icon-focus-sd.png
splash_screen_hd=pkg:/images/splash-hd.jpg
splash_screen_sd=pkg:/images/splash-sd.jpg
splash_color=#0e0e0e
splash_min_time=1500
ui_resolutions=fhd
```

Asset dimensions:
- `icon-focus-hd`: 290 × 218 PNG
- `icon-focus-sd`: 246 × 140 PNG
- `splash-hd`: 1280 × 720 JPG
- `splash-sd`: 720 × 480 JPG

For sideload-dev these are nice-to-have — the channel installs without them but warns. Real assets land before any channel-store submission.

---

## 9. Build, sideload, and dev loop

### One-time

1. Enable developer mode on the Roku: from the home screen press `Home Home Home Up Up Right Left Right Left Right`. Reboots into a developer installer at `http://<roku-ip>` with a username `rokudev` and a password you set on first install.
2. `npm install` at the repo root picks up the new `apps/roku` workspace (adds `roku-deploy`).

### Day-to-day

- Edit BrightScript / XML in `apps/roku/source/` and `apps/roku/components/`.
- `ROKU_HOST=<roku-ip> ROKU_DEV_PASSWORD=<password> npm run roku:deploy` zips the channel, uploads to the dev installer, and launches.
- Output / `print` statements stream to `telnet <roku-ip> 8085` — keep that open in a side terminal.
- The BrightScript debugger (BRD) takes over on uncaught errors, accessible via the same telnet session.

### Production package

`npm run roku:package` produces a signed `.pkg` for store submission. Signing is done on the Roku itself — initial sideload, signed via the dev installer, then `Utilities → Package` on the device. We script the upload but the signing is one-shot in the device UI.

---

## 10. WebSocket replacement: smart polling

The mobile client uses WS for sub-60-second invalidation when the backend's home-data hash changes. Roku can't easily speak WS. We poll instead, with two cadences:

- **Foreground polling.** On the Home tab, poll `/api/home` every 60 s. Sports On Now polls `/api/sports/now` every 30 s when present.
- **Live event polling.** When a SportsDetail scene is open and the event is in-progress, poll `/api/sports/event/:id` every 15 s.

Both polls cancel on scene exit. Cost is one HTTP request per minute while active — negligible.

---

## 11. Persisting settings

Roku's `roRegistrySection` is the analog of localStorage / SharedPreferences. Settings we'll keep:

| Key | Type | Notes |
|---|---|---|
| `apiUrl` | string | e.g. `http://192.168.1.100:3001` |
| `currentUserId` | string | Plex Home user id |
| `connectionType` | `local` \| `remote` | sent in `X-Plex-Connection` |
| `autoSkipIntro` | bool | per-device |
| `autoSkipCredits` | bool | per-device |

Section name: `whatson`. Read on boot, written from SettingsScene.

---

## 12. Phased roadmap

| Phase | Scope | Status |
|---|---|---|
| **0. Spike** | Sideload a 1-screen "hello /api/home" channel that fetches the home payload and renders one Label per item. Validates dev loop, header propagation, CORS. | ✅ Done |
| **1. MVP** | Home tab with shelves; Library tab; detail view; player with HLS playback + position reporting + stop event; Settings. | ✅ Done |
| **2. Search + Sports** | Search with KeyboardDialog; Sports tab with live + later shelves and sports detail; user picker. | ✅ Done |
| **3. Polish** | Mark Watched / Unwatched on detail; Continue Watching exclusion logic; pairing flow; channel art. | ✅ Done (plus beyond-plan: Live TV tab, Whats-On accounts, download-queue management, LATE/Search Now) |
| **4. Store submission** | Channel description, screenshots, content rating, certification testing, response to Roku reviewer feedback. **Blockers: `package.js` fonts gap (see status header).** | ⬜ Not started |

---

## 13. Risks and unknowns

- **2017-era Roku performance.** SceneGraph on a Roku Express is meaningfully slower than on a Stick 4K or Ultra. Lots of poster rows can stutter. Plan: lazy-load row contents, cap shelf size to 30 items, no animations on lower-end devices (detect via `roDeviceInfo.GetModel()`).
- **HLS quirks per server.** Plex and Jellyfin/Emby produce slightly different HLS variants. Roku's Video node handles all major variants but edge cases (DTS audio passthrough, unusual codecs) can fail silently. Plan: keep the existing transcode-to-h264/aac fallback, surface a diagnostic line if `Video.errorMsg` non-empty.
- **CORS / IP scoping.** The mobile app runs on the same LAN; a Roku does too, but the user's API URL must be reachable from the Roku. Backend already binds `0.0.0.0:3001` so this is fine — just a documentation note for users.
- **Channel store review.** Roku review is stricter than Apple/Google for "remote-control-only" UX. Low-friction settings flow matters. Plan: a Plex-style pairing-code helper page on the backend's existing `/setup` admin UI is far less painful than typing an API URL on a remote.
- **No native WebSocket.** Polling covers it for the home/sports use case. If we ever need true live progress (multi-device sync of Continue Watching), we revisit — possibly with Server-Sent Events on the backend, which roUrlTransfer can handle as a streaming response.

---

## 14. What shipped (originally: "What this commit ships")

The original scaffold commit shipped the **Phase 0 spike**. The channel has since grown
through Phase 3 — see the **STATUS** block at the top of this document for the shipped
feature set, the divergences from this plan, and the store-submission blockers.
