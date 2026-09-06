# Whats On — Architecture & Contributor Guide

A cross-platform "what should I watch tonight?" app that unifies Plex, Jellyfin, Emby, Sonarr, Radarr, TMDB, TVmaze, and HDHomeRun tuners into a Netflix-style home experience. Runs on Android, iOS, Android TV, Apple TV, Roku, and the web (SPA served by the backend) today; Windows planned.

See `HANDOFF.md` for current deploy state + resume points, `docs/KNOWN-ISSUES.md` for open issues and incomplete features, `apps/roku/PLAN.md` for the Roku roadmap, and `docs/emby-jellyfin-playback.md` for the Emby/Jellyfin playback quirks history — every load-bearing line in `embyLike.ts` exists because of a specific bug, so read that before changing playback code. (`plan.md`, `LiveTV.md`, and `research.md` are historical planning docs — see their headers.) This file describes the architecture that is actually in code.

**Current model:** `docs/user-model/` — the unified user model (users = people; Whats On owns identity, subsystems are content sources) is **built + shipped as v0.1.144** and live on the fleet (backend has since advanced to v0.1.147 — download-queue cancel/re-search, LATE items + Search Now, opt-in download monitor); it replaced the M7 guest/viewer/binding model. Start at `docs/user-model/STATUS.md` for the current state + resume point, `02-remaining.md` for the remaining backlog (mobile PIN token, Phase C library UI, self-create provisioning, etc.), and `00-vision.md`/`01-implementation.md` for the design. This superseded the remote-access M7 guest flow (`docs/remote-access/STATUS.md` — now a banner + infra reference); its infrastructure (cloud control plane, per-server TLS, device-code, connection racer) carries forward unchanged.

---

## Monorepo Layout

npm workspaces at the root (`apps/*` + `packages/*` globs). Six workspaces:

```
apps/mobile            React Native (Expo) app — phone + TV
apps/roku              SceneGraph / BrightScript channel
apps/web               React SPA (Vite + Tailwind) — served at / by the backend
packages/api           Node + Express backend
packages/shared        Shared TypeScript types + constants
packages/cloud         Remote-access control plane (@whatson/cloud) — rendezvous/address-book service, deployed to Azure (cloud.whatsontv.net)
```

Root scripts (`package.json`): `dev:api`, `dev:mobile`, `dev:web`, `build:api`, `build:web`, `build:shared`, `build:standalone`, `build:installer` (builds `apps/web` first, then the API installer), `service:{install,uninstall,status}`, `roku:deploy`, `roku:package`, `lint`, `typecheck`. All delegate to workspace scripts via `-w`.

Node ≥ 20 required. React is pinned to 19.1.0 via `overrides`.

---

## Backend (`packages/api`)

Express server at `http://localhost:3001` by default. Serves `/api/*` JSON, `/ws` WebSocket, `/setup` static admin UI, and the `apps/web` SPA at `/`.

### Entry + startup (`src/index.ts`)

1. `import './logger.js'` runs first — it monkey-patches `console.log/warn/error` and `uncaughtException` into a file logger.
2. `dotenv.config()` searches **four** locations in order, stopping at the first hit:
   - `<execPath>/.env` (next to the standalone binary)
   - `C:\ProgramData\WhatsOn\.env` (Windows service default)
   - `process.cwd()/.env`
   - `__dirname/../.env` (dev mode next to `dist/`)
3. `hostGuard` (DNS-rebinding guard, `security/httpGuards.ts`) + CORS + JSON are mounted.
4. `mountApiRoutes(app, 'lan')` (`server/surface.ts`) mounts everything under `/api` — it applies `apiAuth` then `userContext`, and splits the **consumer surface** (available on LAN + remote) from the **admin surface** (LAN only). A second listener for remote/TLS traffic is started via `startRemoteListener()` and mounts the consumer surface only.
5. The web SPA is served at `/` (mounted after `/api` and `/setup`; checks `apps/web/dist`, a bundled `web/` dir, or next to the exe).
6. WebSocket server is attached to the same HTTP server.
7. `ensureDefaultAdmin()` (userBootstrap), `startCertManager()`, and `startCloudRegistration()` run at boot; Plex server discovery is kicked off eagerly so artwork URLs work on the first request.

### Config (`src/config.ts`)

Exports a **lazy `Proxy`** — `_config` is built on first property read, not at module load. This matters because the esbuild standalone bundle inlines modules; if config eagerly read `process.env`, it would run before `dotenv.config()` in `index.ts`. Do not change this to eager loading.

`saveConfigToEnv()` rewrites `.env` (preserving comments) and `reloadConfig()` forces the proxy to rebuild — this is how the admin UI's hot reload works after Plex OAuth or service edits.

### Middleware (`src/middleware/`)

Four middleware, mounted by `server/surface.ts` in this order:

- **`apiAuth.ts`** — device-pairing auth. Validates the per-device auth key (`X-Whatson-Auth` header or `auth=` query param) minted by the `/auth/pair/*` flow. Keyless **LAN reads are allowed** (an *invalid* key is rejected; no key is fine locally); remote surface requires a valid key.
- **`userContext.ts`** — attaches the per-request user scope. Primary path reads **`X-Whatson-User`** (unified user model id) plus **`X-Whatson-Session`** (PIN session token, enforced only when `WHATSON_STRICT_PIN` is on); `X-Plex-User` is the legacy fallback. Also reads `X-Plex-Connection: local|remote` so Plex picks the LAN connection vs. plex.tv relay. Per-user data (watched state) is keyed off `req.user.id`.
- **`roles.ts`** — `requireOwner` guard for owner-gated mutations (queue cancel/search, update apply, user admin).
- **`sessionAuth.ts`** — admin session cookie for the `/setup` UI.

### Services (`src/services/`)

| File | Responsibility |
|------|----------------|
| `adapters/` | `MediaServerAdapter` interface + registry. All Plex/Jellyfin/Emby access goes through an adapter; see below. |
| `plex.ts` | `plex.tv` auto-discovery (local-first, single-flight lock), library fetch, watch state, artwork URL generation, Plex search, recommendation hubs, playback info/progress/stop |
| `plexPlayback.ts` | Enumerate Plex clients for "play on this device" delegation |
| `jellyfin.ts` / `emby.ts` | 25-line wrappers over `embyLike.ts`, which contains the shared Jellyfin/Emby service (auth, content, playback, scrobble). |
| `embyLike.ts` | Factory function for the Jellyfin/Emby-compatible API surface. Parameterised by config selector + source tag. See `docs/emby-jellyfin-playback.md` for the bug history behind every load-bearing decision in this file (DeviceProfile shape, `useServerTranscodingUrl` gate, `clientSeekMs` workaround, `SubtitleMethod=External` for off, `VideoBitrate` for quality picks, etc.). |
| `sonarr.ts` | Calendar, history, queue, search, add; quality profiles + root folders for Add picker |
| `radarr.ts` | Same surface as Sonarr for movies |
| `tmdb.ts` | Multi-search (movies + shows), image URL generation |
| `tvmaze.ts` | Show search + episode lookup (Phase 3 groundwork) |
| `liveTv.ts` | TVmaze-backed "What's on TV" shelves — channel list, currently-airing, next-N-hours |
| `tracked.ts` | Watchlist (`data/tracked.json`) + per-user watched state (`data/users/{id}/watched.json`) |
| `users.ts` | Plex Home user list + per-server token resolution (legacy; secondary to `whatsonUsers.ts`) |
| `whatsonUsers.ts` | **Unified user model store** — Whats On users (people) with role, PIN, avatar, and per-subsystem mappings (`mappings.{plex,jellyfin,emby}`); mints PIN session tokens |
| `subsystemUsers.ts` | Provision/deprovision Jellyfin/Emby accounts for a Whats On user (`provisionUser`, `setLibraries`) |
| `userBootstrap.ts` | `ensureDefaultAdmin()` — creates the owner account on first boot |
| `pairing.ts` | Device pairing — pair codes + per-device auth keys consumed by `apiAuth` |
| `secrets.ts` / `session.ts` | Encrypted-at-rest secret storage; admin session store |
| `avatars.ts` / `avatar-pngs.ts` | Built-in avatar set for user profiles |
| `discover.ts` | TMDB search with Sonarr/Radarr fallback when no TMDB key |
| `updater.ts` | GitHub Releases poller; downloads and silently installs new versions (Windows only) |
| `downloadMonitor.ts` | **Opt-in** (`DOWNLOAD_MONITOR=true`) in-process sweeper of the Sonarr/Radarr queues: removes completed-but-unimportable downloads — releases Sonarr/Radarr flag as containing executables/scripts, files with video extensions that aren't video, releases with nothing importable, or imports stuck past `DOWNLOAD_MONITOR_STUCK_MIN`. Primary signal is the queue record's own `statusMessages`; optional `DOWNLOAD_MONITOR_PATH_MAP` lets it inspect the download folder itself (extension list, magic bytes, ffprobe) and delete leftovers. Action = `DELETE /queue/:id?removeFromClient=true&blocklist=true` (gone from Sonarr/Radarr **and** the download client) + re-search (skipped when the Arr's own "Redownload Failed" is on). Known-benign warnings (not an upgrade, path not accessible, unpacking, partial season) are never acted on. Dry-run mode + history in `data/download-monitor.json`; admin panel at `/setup → Download Monitor` |
| `aggregator.ts` | Home + search composition; iterates `getConfiguredAdapters()` for library-server data; "Ready to Watch" / "Coming Soon" rules (incl. `isLate` — past-due-undownloaded items stay 7 days) |
| `live/` | HDHomeRun tuner discovery (`hdhomerun.ts`), ffmpeg HLS proxy (`hlsProxy.ts`), source registry — the tuner-backed Live TV path (`liveTv.ts` above is the older TVmaze guide path; both coexist) |
| `sports/` | Sports shelves — leagues/games data behind `/sports/*` |
| `cloud/` | Cloud-registration client (`registration.ts`) + ACME per-server TLS (`certManager.ts`, `acme.ts`) — talks to `packages/cloud` |
| `streamProxy.ts` | Proxy for remote stream segments |

### Adapter layer (`src/services/adapters/`)

Library-server access (Plex, Jellyfin, Emby) is unified behind `MediaServerAdapter` (see `adapters/types.ts`). Each adapter implements the same surface: `getContinueWatching`, `getRecentlyAdded`, `getLibrary`, `getShowSeasons`, `getSeasonEpisodes`, `search`, `getPlaybackInfo`, `reportProgress`, `stopPlayback`, `markWatched`, `markUnwatched`.

- `adapters/plex.ts` — thin wrapper over `plex.ts` and `users.ts`.
- `adapters/jellyfin.ts` — wraps `jellyfin.ts` (which shares code with Emby via `embyLike.ts`).
- `adapters/emby.ts` — wraps `emby.ts`.
- `adapters/registry.ts` — `getAdapter(kind)`, `getAdapterForSource(source)`, `getConfiguredAdapters()`.

The aggregator, every `library`/`scrobble`/`playback` route, and the `/search` flow all dispatch via `getAdapterForSource(source)`. Adding a fourth media server is a new adapter file + registry entry; no routes change. When multiple library servers are configured, shelves union items from every adapter (Continue Watching, On Deck, Recently Added) and search results merge with library hits taking precedence over Sonarr/Radarr on dedup.

Plex-specific extensions (OAuth PIN flow, `/plex/connections`, Plex Home user switching, remote cast) live in `plex.ts` + `plexPlayback.ts` + `users.ts` and are exposed through `/plex/*` routes — intentionally outside the generic interface.

### Routes (`src/routes/`)

All mounted at `/api`. Notable endpoints:

- `GET /home` — full home screen payload with all shelves
- `GET /tv/{upcoming,recent,downloading}` and `/movies/{upcoming,recent,downloading}`
- `GET /library/:type?source={plex|jellyfin|emby}` + `/library/show/:id/seasons?source=` + season episodes
- `GET /search?q&type` — unified across every configured library server + Sonarr/Radarr
- `GET /discover/search` and `GET/POST/DELETE/PATCH /tracked` — TMDB watchlist
- `GET /recommendations?tmdb={0|1}` — Plex hubs always; TMDB "Because you watched" when key set
- `POST /scrobble`, `/unscrobble`, `/scrobble/all`, `/unscrobble/all` — `source` in body routes via adapter
- `GET /playback/:ratingKey?source={plex|jellyfin|emby}`, `POST /playback/progress`, `POST /playback/stop`
- `GET /auth/providers` — `{ plex, jellyfin, emby, sonarr, radarr }` booleans for client-side flow control
- `/auth/*` — device pairing + admin auth: `admin-status`, `setup-admin`, `login`, `logout`, `change-password`, `pair/{start,poll,complete,pending}`, `redeem-grant`, `GET/DELETE /auth/devices`
- `/whatson-users/*` — unified user model: CRUD, `POST /:id/select` (returns `sessionToken`), `/avatars`, `/libraries/:kind`, `/source/{plex,jellyfin,emby}`, `/guest-profile`
- `POST /queue/cancel`, `/queue/cancel-research`, `/queue/search` — owner-gated Sonarr/Radarr download-queue management (cancel, cancel + re-search, Search Now)
- `GET /live/channels`, `GET /live/now?channels=`, `GET /live/later?channels=&hours=` — "What's on TV" (TVmaze guide path)
- `/live/{tuner-channels,stream/:id,epg,hls/...,sources,all-channels}` — HDHomeRun tuner Live TV (ffmpeg HLS proxy; mobile forces `?format=hls`)
- `/sports/*` — sports shelves + per-user league prefs (mobile hides the tab when no leagues picked)
- `GET /update/status`, `POST /update/check`, `POST /update/apply` — GitHub-Releases auto-update (Windows; `check` only detects, `apply` is owner-gated)
- `GET /download-monitor/status`, `POST /download-monitor/scan[?dryRun=1]` — owner-gated download monitor: config + last sweep + items waiting to import + action history; `scan` runs a sweep now (`dryRun=1` previews without removing)
- `GET /sonarr/{profiles,rootfolders}`, `POST /sonarr/add` (+ Radarr equivalents)
- `GET /users`, `POST /users/select` (legacy Plex Home picker)
- `GET /logs?lines=&filter=`, `GET /logs/info` — log tail for remote debugging
- `/candidates`, `/remote/*` — remote-access support routes (cloud grants, connection info)
- `GET /artwork?url=...` — server-side proxy + 24h cache
- `GET /config`, `/config/status`, `POST /config/test`, `/config/save` + Plex PIN OAuth endpoints
- `GET /health`
- `GET /debug/sonarr/*path` — raw passthrough for troubleshooting

Admin UI (`packages/api/admin/`) is served as static files at `/setup` with `routes/setup.ts` as an HTML fallback when the directory isn't found.

### WebSocket (`src/ws.ts`)

Path: `/ws`. Polls home-data hash every **60 seconds** when clients are connected; broadcasts `{ type: 'invalidate', keys: string[], reason?, timestamp }` on change. `notifyDataChanged()` is called after mutations (scrobble, add tracked, etc.) so clients re-fetch immediately.

### Cache (`src/cache.ts`)

`node-cache` wrapper. TTLs live in `@whatson/shared/constants` — `DEFAULT_CACHE_TTL` (2 min) for home/library, `ARTWORK_CACHE_TTL` (24 h) for image proxy. Empty results are never cached (prevents a cold-start race where the first failed Plex discovery poisons the cache).

### Logging (`src/logger.ts`)

Platform-aware log paths:
- Windows: `C:\ProgramData\WhatsOn\logs\` (fallback: exe dir → temp)
- macOS: `~/Library/Logs/WhatsOn/`
- Linux: `/var/log/whatson/` (fallback: `/tmp`)

Override via `LOG_FILE` env var. Every `console.*` call, including uncaught exceptions, lands here with an ISO timestamp and level prefix.

### Service installer (`src/service.ts`)

One script, three OS backends — detects the platform and calls the right one:
- Windows → NSSM (bundled `nssm.exe`, auto-download fallback)
- Linux → systemd unit file
- macOS → launchd plist at `~/Library/LaunchAgents/`

Commands: `install | uninstall | status`.

### Runtime data (`packages/api/data/`)

- `tracked.json` — **shared** watchlist (all users see it)
- `watched.json` — legacy shared watched state (pre multi-user)
- `users/{userId}/watched.json` — per-user watched state written by `services/tracked.ts`

---

## Mobile app (`apps/mobile`)

React Native + Expo with `react-native-tvos` fork. One codebase ships phone and TV builds.

### Build variants

`app.config.ts` is dynamic — the `WHATSON_TV` environment variable switches assets and the leanback flag. **The store identifier is now unified** across phone + TV on each platform (`com.extrastrength.whatsontv`); `WHATSON_TV` no longer changes the package/bundle, only assets + `androidTVRequired`:

| Variant | Android package | iOS/tvOS bundle | Display name | Assets |
|---------|-----------------|-----------------|--------------|--------|
| Phone (default) | `com.extrastrength.whatsontv` | `com.extrastrength.whatsontv` | Android: `What's On TV` · Apple: `What's On TV Player` | Standard icons |
| TV (`WHATSON_TV=1`) | `com.extrastrength.whatsontv` | `com.extrastrength.whatsontv` | same | TV banner + Apple TV Top Shelf 1280×768 → 4640×1440 |

App Store display name is `What's On TV Player` (via `ios.infoPlist.CFBundleDisplayName`) because `What's On TV` was already taken on Apple; Google Play uses `What's On TV`. iOS + tvOS share one bundle ID (Apple Universal Purchase = one product across both). TV build sets `androidTVRequired: true`. Azure DevOps pipeline produces a separate signed AAB for each. Note: `PLEX_CLIENT_IDENTIFIER` in `packages/shared/src/constants.ts` is a Plex protocol identifier, **not** the store package — it is intentionally left as-is so existing Plex device auth doesn't reset.

### Routing (`app/`)

Expo Router file-based routing.

```
app/
  _layout.tsx              Root: QueryClientProvider, realtime updates, user-auth gate
  player.tsx               Full-screen expo-video player with TV controls + markers
  show-detail.tsx          Show/movie detail with seasons + episodes
  select-user.tsx          Legacy Plex Home "Who's Watching?" picker + PIN entry
  select-whatson-user.tsx  Unified-user "Who's Watching?" picker (primary)
  create-profile.tsx       Self-serve profile creation
  pair-device.tsx          Device pairing (pair-code flow → auth key)
  cloud-signin.tsx         Cloud account sign-in (remote access)
  sports-detail.tsx        Sports game detail
  sports-settings.tsx      League picker for the Sports tab
  (tabs)/
    _layout.tsx      TV: top bar + clock + TVTabButton. Phone: bottom tabs.
    index.tsx        Home (Continue Watching, Ready, Coming Soon, Recommendations)
    tv.tsx           TV Shows
    movies.tsx       Movies
    live-tv.tsx      Live TV (tuner channels + guide)
    sports.tsx       Sports (tab hidden when no leagues configured)
    library.tsx      Plex library grid browser
    search.tsx       "My Library" + "Discover & Track" modes
    settings.tsx     Server config, user, playback + TMDB prefs
```

### Components (`components/`)

- **ContentCard** — poster + badges (LATE, LIVE, RERUN, group count) + progress bar; TV focus highlight + long-press context menu; manages its own focus state to avoid FlatList re-renders
- **ContentShelf** — horizontally scrolling row with edge-trap focus wrapping
- **ShelfList** — stacks multiple shelves; exposes `focusFirst()` for back-button handling
- **DetailSheet** — bottom-sheet modal (uses `Modal` for Android compatibility). Shows download status (%, ETA, progress bar) with owner-gated **Cancel Download** / **Cancel & Re-search** for downloading items, and **Search Now** for coming-soon Sonarr/Radarr items
- **ArrAddPicker** — shared modal for Sonarr/Radarr adds; remembers last-used profile/folder/monitor per service
- **TVFocusable** — `TVPressable` + `TVTextInput` wrappers with focus border styling
- **SportsShelf / ViewAllCard / SourceBadge / ProgressBar / SkeletonCard / ErrorState / Clock**

### Library (`lib/`)

- **api.ts** — typed API client. Sends `X-Whatson-User` (unified users; `X-Plex-User` only in legacy mode), `X-Plex-Connection`, and the device auth key as `X-Whatson-Auth` + `auth=` query param. `resolveArtworkUrl()` rewrites `/api/artwork?...` paths to absolute backend URLs.
- **store.ts** — Zustand: `apiUrl`, `isConfigured`, `isReady`, `currentUser` (a `CurrentUser` with `kind: 'plex' | 'whatson'`), `rememberUser`, `authKey`, `autoSkipIntro`, `autoSkipCredits`, `disableTouchSurface`, `showBecauseYouWatched`, `plexConnectionType`, `liveTvChannels`.
- **storage.ts** — secure persisted settings (expo-secure-store): API URL, saved user, playback prefs, last-used Arr profile/folder/monitor.
- **videoPlayer.ts** — checks for `expo-video` native module (detects Expo Go vs. dev build).
- **tv.ts** — `isTV`, `isTVOS`, `isAndroidTV` platform flags.
- **connection.ts / connectionRace.ts** — remote-access connection racer (races LAN vs. cloud/TLS endpoints, first healthy wins; has unit tests).
- **cloudAuth.ts** — cloud account tokens for remote access.
- **useBackHandler.ts** — tab-scoped back handler via `useIsFocused()`; prevents app exit, scrolls to top + focuses first card.
- **useRealtimeUpdates.ts** — WebSocket client with 5-second auto-reconnect, AppState-driven reconnect on resume, and a suppression flag + pending queue used during video playback (prevents stale data from overwriting live playback position).

### TV focus model

- Every focusable wraps `TVPressable`. Focus highlight: gold border `#E5A00D`.
- Cross-shelf vertical navigation uses `nextFocusUp`/`nextFocusDown` with named node IDs — shelves wire their first/last cards to the adjacent shelf.
- Edge trap: first/last card in a row sets `nextFocusLeft`/`nextFocusRight` to itself so focus doesn't escape the shelf.
- FlatLists on TV have `scrollEnabled={false}` with manual scroll control tied to focused card index.
- Safe areas: Apple TV 90/60 px, Android TV 48/27 px. TV cards are 160×240; phone cards are 140×210.

### Data fetching

TanStack Query (React Query) for all server data. Query keys align 1:1 with the WebSocket's `invalidate.keys` payload — server-driven invalidation is automatic.

### Video player (`app/player.tsx`)

- `expo-video` + HLS from Plex transcode
- 9 bitrate presets (1.5–20 Mbps + direct play)
- Mid-playback quality switch with position resume
- D-pad ±10 s seek, progress-bar scrub ±30 s, auto-hide controls after 5 s
- Plex decision endpoint used for reliable track/quality switching
- Progress posted to Plex every 10 seconds
- Subtitle + audio track selection (burn-in via Plex transcode for subs, `PUT /library/parts` preference for audio)
- Skip intro / skip credits buttons from Plex markers; auto-skip is a persisted per-device preference
- Realtime updates are suppressed during playback via `useRealtimeUpdates`

---

## Shared (`packages/shared`)

Types (`types.ts`): `ContentItem` (incl. `isLate` + `download: DownloadStatus`), `ContentSection`, `Artwork`, `Progress`, `Availability`, `DownloadStatus`, `HomeResponse`, `SearchResponse`, `ApiResponse<T>`, `TrackedItem`, `TmdbSearchResult`, `StreamingProvider` + the 29-entry `STREAMING_PROVIDERS` list, `LiveChannel`/`LiveStreamInfo`/`LiveProgram`, `PlexConfig`, `SonarrConfig`, `RadarrConfig`, `EpgConfig`, `DownloadMonitorConfig`, `ServerConfig`. `DownloadStatus.warnings` carries the Arr's flattened `statusMessages` for a completed-but-unimported item.

Constants (`constants.ts`): `APP_NAME`, `APP_VERSION`, `PLEX_CLIENT_IDENTIFIER`, `PLEX_PRODUCT`, cache TTLs, source colors + labels, `TVMAZE_BASE_URL`, `TMDB_BASE_URL`, `TMDB_IMAGE_BASE`, `DEFAULT_CLOUD_URL`, `DEFAULT_EPG_COUNTRY`.

---

## Build + deploy

### Backend standalone (`scripts/build-standalone.js`)

esbuild bundles TypeScript + all `node_modules` into one CJS file, then Node.js Single Executable Application (SEA) injects the blob into the Node binary via `postject`. macOS re-signs ad-hoc after injection. Output: `whatson-api.exe` (Windows) or `whatson-api` (Linux/macOS). The `admin/` directory is copied alongside the binary for the `/setup` UI. `--skip-sea` for bundle-only builds.

### Linux installers (`scripts/create-installer.js`)

Produces `.deb` + `.rpm` via `fpm`. Installs the binary, a sample `.env`, and a systemd unit.

### CI (`azure-pipelines.yml`)

Four stages, manual trigger only:

1. **Backend** — TypeScript typecheck + build
2. **BackendInstaller** — standalone binary + `.deb` + `.rpm`
3. **Mobile** — signed phone AAB (`com.extrastrength.whatsontv`)
4. **TV** — signed TV AAB (`com.extrastrength.whatsontv`)

Installs Java 17 + Android SDK (platform 36, build-tools 36.0.0). Keystore comes from pipeline secrets. `scripts/patch-signing.py` patches Gradle for CI signing.

### User's running backend

The user's backend lives at **`http://192.168.1.181:3001`** on their LAN. When you need to inspect runtime state mid-debug — backend logs, current update status, the resolved API URL Roku is hitting, etc. — fetch directly from there with `WebFetch` rather than asking the user to copy-paste.

Useful endpoints:

- `GET /api/health` — quick liveness + version check
- `GET /api/update/status` — currentVersion, latestVersion, updateAvailable
- `GET /api/logs` — last 200 lines of the backend log (text/plain)
- `GET /api/logs?lines=500` — bigger tail, max 5000
- `GET /api/logs?filter=plex.subs` — only lines containing the filter string (great for tag-prefixed log lines we sprinkle in)
- `GET /api/logs/info` — log file path + size + last-modified, for sanity-checking logging is alive
- `GET /api/config/status` — provider config status (which media servers are configured, etc.)

The user's network is local-only; `apiAuth` allows keyless LAN reads, so no tokens are needed for GETs from inside the LAN (a *stale/invalid* auth key is rejected — omit the key entirely rather than sending an old one).

### Shipping a backend release

When the user asks to "deploy the backend" or "ship a release", run the full pipeline — version bump, commit, push, build the installer, publish a GitHub release. The Windows in-channel updater polls `https://api.github.com/repos/<repo>/releases/latest` and installs whatever asset matches `*setup.exe`, so the GitHub release IS the deploy mechanism. Don't stop at "commit and push" — that doesn't reach the running services.

```bash
# 1. Bump version IN TWO PLACES (this matters — see updater note below):
#    a. packages/api/package.json   "version": "0.1.NN"
#    b. packages/shared/src/constants.ts   APP_VERSION = '0.1.NN'
#    The updater compares the running binary's APP_VERSION (baked from
#    constants.ts at build time) against the GitHub tag. If you bump
#    only package.json, the binary reports its OLD version forever and
#    the updater re-installs the same release in a loop on every poll.

# 2. Stage backend files only — Roku/mobile work-in-progress stays local.
git add packages/api/package.json packages/shared/src/constants.ts packages/api/src/... package-lock.json

# 3. Commit + push
git commit -m "v0.1.NN — short description" -m "longer body"
git push origin main

# 4. Build installer (NSIS Windows installer + portable zip + standalone exe)
npm run build:installer
# Outputs to packages/api/installers/:
#   whatson-api-<version>-setup.exe         ← what the updater picks up
#   whatson-api-<version>-win32-portable.zip

# 5. Cut the GitHub release with both assets attached
gh release create v0.1.NN \
  packages/api/installers/whatson-api-0.1.NN-setup.exe \
  packages/api/installers/whatson-api-0.1.NN-win32-portable.zip \
  --title "v0.1.NN — short description" \
  --notes "<full body>"
```

The updater (`packages/api/src/services/updater.ts`) finds the release within minutes. NSIS installer brings down the running NSSM service, swaps the binary, and brings it back — no manual restart needed on user machines.

### Running locally

```bash
npm install                                  # workspaces
cp packages/api/.env.example packages/api/.env
npm run dev:api                              # backend on :3001
npm run dev:mobile                           # Expo dev server

# Android TV build
WHATSON_TV=1 npx expo run:android --cwd apps/mobile

# Install backend as a service
npm run service:install
```

Set `EXPO_PUBLIC_API_URL` for the mobile app if the backend isn't on `localhost:3001`. On Android emulators the default swaps to `http://10.0.2.2:3001/api`.

---

## Conventions that matter

1. **Never eagerly read `process.env` in `config.ts`.** The lazy Proxy is load-bearing for the standalone build. Call `reloadConfig()` after any dotenv load (index.ts already does).
2. **Every API route goes through `userContext` middleware.** Don't bypass it — per-user watched state and Plex tokens depend on `req.user`.
3. **Library-server access must go through the adapter registry.** Call `getAdapterForSource(source)` rather than importing `plex.ts` / `jellyfin.ts` / `emby.ts` directly from routes or the aggregator. New media servers plug in as a single registry entry with zero route changes.
4. **Artwork URLs are always proxied via `/api/artwork`.** Route auto-detects Plex/Jellyfin/Emby and attaches the correct auth. Server-side 24 h disk cache.
5. **Empty results must not be cached.** Plex discovery can transiently return nothing on boot; the aggregator guards against this.
6. **TV builds use `react-native-tvos`, not stock `react-native`.** Check `isTV` from `lib/tv.ts` before using TV-only APIs (`useTVEventHandler`, `hasTVPreferredFocus`).
7. **WebSocket invalidation keys match TanStack Query keys exactly.** Add a new query → add the matching key to the server's broadcast list.
8. **`X-Plex-Connection: local|remote`** lets Plex pick the best link; the app tracks this in Zustand (`plexConnectionType`) and sends it on every request. Jellyfin/Emby use a single URL — header is ignored for those sources.
9. **Client passes `source` with every library call** (`?source=plex|jellyfin|emby` on library/playback, `source` in scrobble bodies). Backends default to Plex when missing, for back-compat with pre-adapter clients.
10. **Android detail sheets use `Modal`, not a custom portal.** Non-modal implementations render invisibly on Android.
11. **Roku must match Android TV / tvOS — features, look, and feel.** The mobile TV apps are the design reference for the Roku channel. Tabs, shelves, defaults (sort orders, type toggles, time windows), focus colour (`#E5A00D`), poster aspect ratios, detail-sheet actions — all should look and behave like the user's tvOS / Android TV experience. When a Roku platform constraint forces a divergence (e.g. SceneGraph lacks an exact equivalent), record it in `apps/roku/PLAN.md` and treat closing the gap as a follow-up, not a permanent decision. Don't invent Roku-only UX patterns. See `apps/roku/PLAN.md §1` for the full parity commitments.
