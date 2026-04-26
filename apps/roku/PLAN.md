# Whats On — Roku Channel Plan

This document is the architecture and delivery plan for the Roku client. It assumes the existing `packages/api` backend is unchanged and that the React Native phone/TV codebase under `apps/mobile` is the reference UX. The Roku build is **not** a port — it's a clean-slate channel in BrightScript and SceneGraph that talks to the same HTTP API.

---

## 1. Goals — Roku must match Android TV / tvOS

**The Android TV (`com.whatson.tv`) and tvOS apps are the design reference.**
Every screen, every interaction, every default value the Roku channel ships
should match what the user sees on those builds. When the implementation
forces a divergence (Roku platform constraint, missing SceneGraph primitive),
note the divergence in this plan and treat closing the gap as a follow-up,
not a permanent decision.

Concrete commitments:

- **Feature set** — same tabs (Home / TV Shows / Movies / Library / Search /
  Sports / Settings), same shelves on Home (Continue Watching, Ready to
  Watch — TV/Movies, Coming Soon — TV/Movies, Sports On Now / Later, "What's
  on TV"), same detail-sheet actions (Play, Mark Watched, Mark Unwatched,
  Add to Sonarr/Radarr).
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

| Phase | Scope | Effort |
|---|---|---|
| **0. Spike** | Sideload a 1-screen "hello /api/home" channel that fetches the home payload and renders one Label per item. Validates dev loop, header propagation, CORS. | 1 day |
| **1. MVP** | Home tab with shelves; Library tab; DetailScene; PlayerScene with HLS playback + position reporting + stop event; Settings (API URL only). | 1.5 weeks |
| **2. Search + Sports** | Search with KeyboardDialog; Sports tab with live + later shelves and SportsDetail; Plex Home user picker. | 1 week |
| **3. Polish** | Subtitle / audio track switching; Mark Watched / Unwatched on detail; Continue Watching exclusion logic; pairing flow for Plex token; channel art; signed .pkg build. | 1 week |
| **4. Store submission** | Channel description, screenshots, content rating, certification testing, response to Roku reviewer feedback. | 1–2 weeks (mostly waiting) |

Total: roughly **4–5 weeks of focused work** for a store-ready channel. MVP usable on a private device after week 2.

---

## 13. Risks and unknowns

- **2017-era Roku performance.** SceneGraph on a Roku Express is meaningfully slower than on a Stick 4K or Ultra. Lots of poster rows can stutter. Plan: lazy-load row contents, cap shelf size to 30 items, no animations on lower-end devices (detect via `roDeviceInfo.GetModel()`).
- **HLS quirks per server.** Plex and Jellyfin/Emby produce slightly different HLS variants. Roku's Video node handles all major variants but edge cases (DTS audio passthrough, unusual codecs) can fail silently. Plan: keep the existing transcode-to-h264/aac fallback, surface a diagnostic line if `Video.errorMsg` non-empty.
- **CORS / IP scoping.** The mobile app runs on the same LAN; a Roku does too, but the user's API URL must be reachable from the Roku. Backend already binds `0.0.0.0:3001` so this is fine — just a documentation note for users.
- **Channel store review.** Roku review is stricter than Apple/Google for "remote-control-only" UX. Low-friction settings flow matters. Plan: a Plex-style pairing-code helper page on the backend's existing `/setup` admin UI is far less painful than typing an API URL on a remote.
- **No native WebSocket.** Polling covers it for the home/sports use case. If we ever need true live progress (multi-device sync of Continue Watching), we revisit — possibly with Server-Sent Events on the backend, which roUrlTransfer can handle as a streaming response.

---

## 14. What this commit ships

The accompanying scaffold ships the **Phase 0 spike**, runnable against a real Roku in dev mode with a single `npm run roku:deploy`. Specifically:

- Workspace at `apps/roku/` with valid `manifest`, `package.json`, source layout, and the deploy script.
- A `HomeScene` that fetches `/api/home` and renders one row per section as posters in a `RowList`.
- `ApiTask` + `Headers` utility — the foundation that all subsequent screens will reuse.
- README with the dev-mode enable steps, env vars for the deploy script, and the telnet debug command.

Phases 1+ are follow-ups; nothing in this scaffold is wasted when we expand into them.
