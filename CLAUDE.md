# Whats On — Architecture & Contributor Guide

A cross-platform "what should I watch tonight?" app that unifies Plex, Sonarr, Radarr, TMDB, and TVmaze into a Netflix-style home experience. Runs on Android, iOS, Android TV, Apple TV today; Windows and Roku planned.

See `plan.md` for phase-by-phase status. This file describes the architecture that is actually in code.

---

## Monorepo Layout

npm workspaces at the root. Three workspaces:

```
apps/mobile            React Native (Expo) app — phone + TV
packages/api           Node + Express backend
packages/shared        Shared TypeScript types + constants
```

Root scripts (`package.json`): `dev:api`, `dev:mobile`, `build:api`, `build:standalone`, `build:installer`, `service:{install,uninstall,status}`, `lint`, `typecheck`. All delegate to workspace scripts via `-w`.

Node ≥ 20 required. React is pinned to 19.1.0 via `overrides`.

---

## Backend (`packages/api`)

Express server at `http://localhost:3001` by default. Serves `/api/*` JSON, `/ws` WebSocket, and `/setup` static admin UI.

### Entry + startup (`src/index.ts`)

1. `import './logger.js'` runs first — it monkey-patches `console.log/warn/error` and `uncaughtException` into a file logger.
2. `dotenv.config()` searches **four** locations in order, stopping at the first hit:
   - `<execPath>/.env` (next to the standalone binary)
   - `C:\ProgramData\WhatsOn\.env` (Windows service default)
   - `process.cwd()/.env`
   - `__dirname/../.env` (dev mode next to `dist/`)
3. CORS + JSON + `userContext` middleware are mounted.
4. Routers are mounted under `/api`.
5. WebSocket server is attached to the same HTTP server.
6. Plex server discovery is kicked off eagerly so artwork URLs work on the first request.

### Config (`src/config.ts`)

Exports a **lazy `Proxy`** — `_config` is built on first property read, not at module load. This matters because the esbuild standalone bundle inlines modules; if config eagerly read `process.env`, it would run before `dotenv.config()` in `index.ts`. Do not change this to eager loading.

`saveConfigToEnv()` rewrites `.env` (preserving comments) and `reloadConfig()` forces the proxy to rebuild — this is how the admin UI's hot reload works after Plex OAuth or service edits.

### Middleware (`src/middleware/userContext.ts`)

Reads `X-Plex-User` and `X-Plex-Connection: local|remote` headers on every `/api/*` request and attaches a per-request user scope. Plex services resolve the correct per-user token from `services/users.ts`. Per-user data (watched state) is keyed off `req.user.id`.

The client always sends both headers (`lib/api.ts` `fetchApi`). `X-Plex-Connection` lets Plex pick the LAN connection on the same network vs. plex.tv relay when remote.

### Services (`src/services/`)

| File | Responsibility |
|------|----------------|
| `plex.ts` | `plex.tv` auto-discovery (local-first, single-flight lock), library fetch, watch state, artwork URL generation, Plex search, recommendation hubs |
| `plexPlayback.ts` | Enumerate Plex clients for "play on this device" delegation |
| `sonarr.ts` | Calendar, history, queue, search, add; quality profiles + root folders for Add picker |
| `radarr.ts` | Same surface as Sonarr for movies |
| `tmdb.ts` | Multi-search (movies + shows), image URL generation |
| `tvmaze.ts` | Show search + episode lookup (Phase 3 groundwork) |
| `tracked.ts` | Watchlist (`data/tracked.json`) + per-user watched state (`data/users/{id}/watched.json`) |
| `users.ts` | Plex Home user list + per-server token resolution |
| `discover.ts` | TMDB search with Sonarr/Radarr fallback when no TMDB key |
| `aggregator.ts` | Home + search composition; cross-source merging; "Ready to Watch" / "Coming Soon" rules |

### Routes (`src/routes/`)

All mounted at `/api`. Notable endpoints:

- `GET /home` — full home screen payload with all shelves
- `GET /tv/{upcoming,recent,downloading}` and `/movies/{upcoming,recent,downloading}`
- `GET /library/:type` + `/library/show/:ratingKey/seasons` + season episodes
- `GET /search?q&type` — unified Plex + Sonarr/Radarr
- `GET /discover/search` and `GET/POST/DELETE/PATCH /tracked` — TMDB watchlist
- `GET /recommendations?tmdb={0|1}` — Plex hubs always; TMDB "Because you watched" when key set
- `POST /scrobble`, `/unscrobble`, `/scrobble/all`, `/unscrobble/all`
- `GET /playback/:ratingKey`, `POST /playback/progress`, `POST /playback/stop`
- `GET /sonarr/{profiles,rootfolders}`, `POST /sonarr/add` (+ Radarr equivalents)
- `GET /users`, `POST /users/select`
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

`app.config.ts` is dynamic — the `WHATSON_TV` environment variable switches everything:

| Variant | Android package | iOS bundle | Assets |
|---------|-----------------|------------|--------|
| Phone (default) | `com.whatson.app` | `com.whatson.app` | Standard icons |
| TV (`WHATSON_TV=1`) | `com.whatson.tv` | `com.whatson.tv` | TV banner + Apple TV Top Shelf 1280×768 → 4640×1440 |

TV build sets `androidTVRequired: true`. Azure DevOps pipeline produces a separate signed AAB for each.

### Routing (`app/`)

Expo Router file-based routing.

```
app/
  _layout.tsx        Root: QueryClientProvider, realtime updates, user-auth gate
  player.tsx         Full-screen expo-video player with TV controls + markers
  show-detail.tsx    Show/movie detail with seasons + episodes
  select-user.tsx    "Who's Watching?" picker + PIN entry
  (tabs)/
    _layout.tsx      TV: top bar + clock + TVTabButton. Phone: bottom tabs.
    index.tsx        Home (Continue Watching, Ready, Coming Soon, Recommendations)
    tv.tsx           TV Shows
    movies.tsx       Movies
    library.tsx      Plex library grid browser
    search.tsx       "My Library" + "Discover & Track" modes
    settings.tsx     Server config, user, playback + TMDB prefs
```

### Components (`components/`)

- **ContentCard** — poster + badge + progress bar; TV focus highlight + long-press context menu; manages its own focus state to avoid FlatList re-renders
- **ContentShelf** — horizontally scrolling row with edge-trap focus wrapping
- **ShelfList** — stacks multiple shelves; exposes `focusFirst()` for back-button handling
- **DetailSheet** — bottom-sheet modal (uses `Modal` for Android compatibility)
- **ArrAddPicker** — shared modal for Sonarr/Radarr adds; remembers last-used profile/folder/monitor per service
- **TVFocusable** — `TVPressable` + `TVTextInput` wrappers with focus border styling
- **SourceBadge / ProgressBar / SkeletonCard / ErrorState / Clock**

### Library (`lib/`)

- **api.ts** — typed API client. Always sends `X-Plex-User` and `X-Plex-Connection` headers. `resolveArtworkUrl()` rewrites `/api/artwork?...` paths to absolute backend URLs.
- **store.ts** — Zustand: `apiUrl`, `isConfigured`, `isReady`, `currentUser`, `rememberUser`, `autoSkipIntro`, `autoSkipCredits`, `disableTouchSurface`, `showBecauseYouWatched`, `plexConnectionType`.
- **storage.ts** — secure persisted settings (expo-secure-store): API URL, saved user, playback prefs, last-used Arr profile/folder/monitor.
- **videoPlayer.ts** — checks for `expo-video` native module (detects Expo Go vs. dev build).
- **tv.ts** — `isTV`, `isTVOS`, `isAndroidTV` platform flags.
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

Types (`types.ts`): `ContentItem`, `ContentSection`, `Artwork`, `Progress`, `Availability`, `HomeResponse`, `SearchResponse`, `ApiResponse<T>`, `TrackedItem`, `TmdbSearchResult`, `StreamingProvider`, `PlexConfig`, `SonarrConfig`, `RadarrConfig`, `EpgConfig`, `ServerConfig`.

Constants (`constants.ts`): `APP_NAME`, `APP_VERSION`, `PLEX_CLIENT_IDENTIFIER`, `PLEX_PRODUCT`, cache TTLs, source colors + labels, `TVMAZE_BASE_URL`, `TMDB_BASE_URL`, `TMDB_IMAGE_BASE`, 13-provider streaming list.

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
3. **Mobile** — signed phone AAB (`com.whatson.app`)
4. **TV** — signed TV AAB (`com.whatson.tv`)

Installs Java 17 + Android SDK (platform 36, build-tools 36.0.0). Keystore comes from pipeline secrets. `scripts/patch-signing.py` patches Gradle for CI signing.

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

1. **Never eagerly read `process.env` in `config.ts`.** The lazy Proxy is load-bearing for the standalone build.
2. **Every API route goes through `userContext` middleware.** Don't bypass it — per-user watched state and Plex tokens depend on `req.user`.
3. **Artwork URLs are always proxied via `/api/artwork`.** This keeps Plex tokens server-side and lets us disk-cache 24 h.
4. **Empty results must not be cached.** Plex discovery can transiently return nothing on boot; the aggregator guards against this.
5. **TV builds use `react-native-tvos`, not stock `react-native`.** Check `isTV` from `lib/tv.ts` before using TV-only APIs (`useTVEventHandler`, `hasTVPreferredFocus`).
6. **WebSocket invalidation keys match TanStack Query keys exactly.** Add a new query → add the matching key to the server's broadcast list.
7. **`X-Plex-Connection: local|remote`** lets Plex pick the best link; the app tracks this in Zustand (`plexConnectionType`) and sends it on every request.
8. **Android detail sheets use `Modal`, not a custom portal.** Non-modal implementations render invisibly on Android.
