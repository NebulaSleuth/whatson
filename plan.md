# "Whats On" — Implementation Plan

> **Last Updated**: 2026-03-25
> **Current Phase**: Phase 2 nearly complete, beginning Phase 3
> **Overall Progress**: Phases 1, 1.5, 2 substantially complete

---

## Status Summary

| Phase | Status | Progress |
|-------|--------|----------|
| **Phase 1**: Foundation (Backend + Mobile) | **Complete** | ██████████████ 100% |
| **Phase 1.5**: Discovery & Tracking | **Complete** | ██████████████ 100% |
| **Phase 2**: TV Platforms + Video Player + Infrastructure | **Near Complete** | ████████████░░ 90% |
| **Phase 3**: Windows + Live TV | Not Started | ░░░░░░░░░░░░░░ 0% |
| **Phase 4**: Enhanced Features | Not Started | ░░░░░░░░░░░░░░ 0% |
| **Phase 5**: Roku + Polish | Not Started | ░░░░░░░░░░░░░░ 0% |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│                                                                  │
│  ┌──────────────────────────────┐  ┌──────────────────────────┐  │
│  │   React Native App           │  │   Roku Channel           │  │
│  │   (TypeScript + Expo)        │  │   (BrightScript/         │  │
│  │                              │  │    SceneGraph + SGDEX)   │  │
│  │  • Android / Android TV      │  │                          │  │
│  │  • iOS / Apple TV (tvOS)     │  │  • Roku devices          │  │
│  │  • Windows                   │  │                          │  │
│  └──────────┬───────────────────┘  └──────────┬───────────────┘  │
│             │                                 │                  │
└─────────────┼─────────────────────────────────┼──────────────────┘
              │          REST / WebSocket        │
              ▼                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Backend API Gateway                          │
│                     (Node.js + Express)                          │
│                                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Plex        │ │ Sonarr      │ │ Radarr   │ │ TMDB         │  │
│  │ Service     │ │ Service     │ │ Service  │ │ Service      │  │
│  │ (plex.tv    │ │             │ │          │ │              │  │
│  │  discovery) │ │             │ │          │ │              │  │
│  └──────┬──────┘ └──────┬──────┘ └────┬─────┘ └──────┬───────┘  │
│         │               │             │               │          │
│  ┌──────┴───────────────┴─────────────┴───────────────┴───────┐  │
│  │                    Unified Data Layer                       │  │
│  │  • Normalize content from all sources                      │  │
│  │  • Merge watch state + availability + schedules            │  │
│  │  • Cache layer (in-memory via node-cache)                  │  │
│  │  • WebSocket for real-time updates                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Infrastructure                          │  │
│  │  • Cross-platform service installer (NSSM/systemd/launchd)│  │
│  │  • Standalone executable (Node.js SEA + esbuild)          │  │
│  │  • File-based logging with platform-aware paths           │  │
│  │  • Azure DevOps CI/CD pipeline                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Optional Services (Phase 4+)            │  │
│  │  • Auth (multi-user profiles)                              │  │
│  │  • Trakt.tv sync                                           │  │
│  │  • Overseerr/Ombi proxy (content requests)                 │  │
│  │  • Push notification service (FCM/APNs)                    │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
              │               │            │
              ▼               ▼            ▼
        ┌──────────┐  ┌───────────┐  ┌──────────┐
        │ Plex     │  │ Sonarr    │  │ Radarr   │
        │ Server   │  │ Server    │  │ Server   │
        │(local or │  │(local or  │  │(local or │
        │ remote)  │  │ remote)   │  │ remote)  │
        └──────────┘  └───────────┘  └──────────┘
```

**Connectivity**: The backend supports both local and remote access:
- **Plex**: Auto-discovers server via `plex.tv` API (just needs token), or connects to a direct URL
- **Sonarr/Radarr**: Connects to whatever URL is in `.env` — local IP or public remote URL

---

## Data Models

### Unified Content Item

```typescript
interface ContentItem {
  id: string;                          // Internal unique ID
  type: 'movie' | 'episode' | 'show';
  title: string;                       // Movie title or episode title
  showTitle?: string;                  // Parent show name (episodes only)
  seasonNumber?: number;
  episodeNumber?: number;
  summary: string;
  duration: number;                    // Minutes
  artwork: {
    poster: string;                    // 2:3 portrait URL
    thumbnail: string;                 // 16:9 landscape URL
    background: string;                // Fanart URL
  };
  source: 'plex' | 'sonarr' | 'radarr' | 'live';
  sourceId: string;                    // ID in the source system
  status: 'watching' | 'ready' | 'coming_soon' | 'downloading' | 'live_now';
  progress: {
    watched: boolean;
    percentage: number;                // 0-100
    currentPosition: number;           // Seconds
  };
  availability: {
    availableAt: string;               // ISO 8601 datetime
    channel?: string;                  // Live TV channel name
    network?: string;                  // Network name
  };
  playbackUrl?: string;               // Deep link to play in Plex
  addedAt: string;                     // ISO 8601
  year: number;
  rating?: number;
  genres?: string[];
}

interface ContentSection {
  id: string;
  title: string;                       // "Continue Watching", "Ready to Watch", etc.
  type: 'tv' | 'movie' | 'mixed';
  items: ContentItem[];
  sortOrder: number;
}
```

### Server Configuration

```typescript
interface ServerConfig {
  plex: {
    url: string;                       // Empty = auto-discover via plex.tv; or direct URL
    token: string;                     // X-Plex-Token (required)
  };
  sonarr: {
    url: string;                       // Local or remote URL
    apiKey: string;
  };
  radarr: {
    url: string;                       // Local or remote URL
    apiKey: string;
  };
  epg: {
    provider: 'tvmaze' | 'tmdb' | 'xmltv';
    country: string;                   // ISO country code
    tmdbApiKey?: string;
    xmltvUrl?: string;
  };
}
```

---

## Phased Implementation Plan

### Phase 1: Foundation (Backend + Core Mobile App) ✅ COMPLETE

**Goal**: Working backend API + basic mobile app showing Plex content on Android and iOS.

#### 1.1 — Project Scaffolding ✅ COMPLETE
- [x] Initialize npm workspaces monorepo
  ```
  whatson/
  ├── apps/
  │   └── mobile/          # React Native (Expo) app
  ├── packages/
  │   ├── api/             # Backend API server
  │   └── shared/          # Shared types, constants, utilities
  ├── package.json
  └── tsconfig.base.json
  ```
- [x] Set up Expo with React Native
- [x] Set up Node.js + Express backend with TypeScript
- [x] Configure Prettier, TypeScript across monorepo
- [x] Set up environment variable management (.env for server configs)

#### 1.2 — Backend: Plex Service ✅ COMPLETE
- [x] Auto-discover server via plex.tv API (remote) or use direct URL (local)
- [x] Token-based authentication with required Plex headers
- [x] `GET /api/home` — includes On Deck + Continue Watching from Plex
- [x] `GET /api/home` — includes Recently Added from Plex
- [x] `POST /api/scrobble` — mark item as watched via Plex
- [x] `POST /api/unscrobble` — mark item as unwatched
- [x] Artwork URL generation with token authentication
- [x] Normalize Plex metadata to unified ContentItem model
- [x] Error handling and connection health checks (`GET /api/health`)
- [ ] Web Admin UI for server configuration (replaces need for manual .env editing — see Phase 2.16)

#### 1.3 — Backend: Sonarr Service ✅ COMPLETE
- [x] API key authentication
- [x] `GET /api/tv/upcoming` — fetch Sonarr calendar (next 7 days)
- [x] `GET /api/tv/recent` — fetch recently downloaded episodes from Sonarr history
- [x] `GET /api/tv/downloading` — fetch Sonarr queue
- [x] Normalize Sonarr data to ContentItem model
- [ ] Merge Sonarr data with Plex watch state (match by series/episode)

#### 1.4 — Backend: Radarr Service ✅ COMPLETE
- [x] API key authentication
- [x] `GET /api/movies/recent` — recently downloaded movies from history
- [x] `GET /api/movies/upcoming` — upcoming releases from calendar
- [x] `GET /api/movies/downloading` — Radarr queue
- [x] Normalize Radarr data to ContentItem model
- [ ] Merge Radarr data with Plex watch state

#### 1.5 — Backend: Unified Aggregation ✅ COMPLETE
- [x] `GET /api/home` — aggregated home screen data with all sections:
  - Continue Watching (in-progress from Plex, sorted by last watched)
  - Ready to Watch TV (downloaded episodes not yet watched)
  - Ready to Watch Movies (downloaded movies not yet watched)
  - Coming Soon TV (Sonarr calendar, sorted by availability date)
  - Coming Soon Movies (Radarr calendar, sorted by release date)
- [x] Filter out completed/watched items from all lists
- [x] Sort in-progress items to front of each list
- [x] In-memory cache with configurable TTL (default 5 min)
- [x] `GET /api/search?q={query}&type={tv|movie}` — search across all sources
- [x] `GET /api/config/status` — check which services are configured
- [x] `POST /api/config/test` — test connection to a service

#### 1.6 — Mobile App: Core UI (Android + iOS) ✅ COMPLETE
- [x] App navigation setup with Expo Router (bottom tabs: Home, TV Shows, Movies, Search)
- [x] Dark theme setup (colors, typography, spacing tokens)
- [x] **Home Screen**: Vertical scroll of horizontal content shelves
  - Each shelf: title + horizontally scrolling FlatList of cards
  - Card component: poster (2:3), title, source badge, progress bar
- [x] **Card Detail Sheet**: Full metadata — artwork, summary, episode info, duration, source, progress, "Mark as Watched" button
- [x] **TV Shows Tab**: Filtered view — Downloading + Ready to Watch + Coming Soon shelves
- [x] **Movies Tab**: Filtered view — Downloading + Recently Downloaded + Coming Soon shelves
- [x] **Search Screen**: Search bar + filter chips (All | TV Shows | Movies) + results grid with debounced search
- [x] Pull-to-refresh on all screens
- [x] Loading skeletons (shimmer animation)
- [x] Error state UI with retry button
- [x] Settings tab with full server config display

---

### Phase 1.5: Discovery & Tracking ✅ COMPLETE

**Goal**: Search TMDB for shows/movies not in library, track them with a streaming provider.

#### 1.5.1 — TMDB Search ✅ COMPLETE
- [x] TMDB multi-search service (movies + TV shows)
- [x] `GET /api/discover/search?q={query}` — search TMDB
- [x] Results show poster, title, year, rating, overview
- [x] Results indicate if item is already tracked

#### 1.5.2 — Tracked Items / Watchlist ✅ COMPLETE
- [x] File-based tracked items storage (`data/tracked.json`)
- [x] `GET /api/tracked` — list all tracked items
- [x] `POST /api/tracked` — add item with streaming provider
- [x] `DELETE /api/tracked/:tmdbId` — remove tracked item
- [x] `PATCH /api/tracked/:tmdbId` — update provider
- [x] Provider picker modal with 13 streaming providers:
  - YouTube TV, Hulu, Netflix, Disney+, HBO Max, Amazon Prime,
    Apple TV+, Peacock, Paramount+, Plex, Sonarr, Radarr, Other

#### 1.5.3 — Search UI Enhancement ✅ COMPLETE
- [x] Two-mode search: "My Library" (existing) + "Discover & Track" (TMDB)
- [x] Discover results show as list cards with poster, metadata, overview
- [x] "+ Track" button opens provider picker
- [x] "Tracked" badge on already-tracked items

#### 1.5.4 — Settings Enhancement ✅ COMPLETE
- [x] Full server config display (Plex URL/token, Sonarr URL/key, Radarr URL/key, EPG settings)
- [x] Secrets masked with last 4 chars visible
- [x] Service connection status with colored indicators

#### 1.5.5 — Bug Fixes & Polish ✅ COMPLETE
- [x] Plex discovery now prefers local connections over remote (fixes timeouts)
- [x] Plex discovery lock — only one discovery runs at a time (prevents race conditions)
- [x] Sonarr/Radarr JSON string response parsing (was returning 0 results)
- [x] Trailing slash in URLs stripped from config
- [x] Empty results are never cached (prevents startup race condition)
- [x] TVmaze integration removed (not useful without specific tracked channels)
- [x] TMDB search with Sonarr/Radarr lookup fallback (no TMDB key required)
- [x] Detail sheet uses Modal for Android compatibility (was invisible on Android)
- [x] "Ready to Watch" = Plex + tracked items (no Sonarr — those go to Coming Soon until in Plex)
- [x] Continue Watching items excluded from Ready to Watch (no duplicates)
- [x] Coming Soon items show expected availability date overlay on card (Today/Tomorrow/Wed/Mar 25)
- [x] Tracked items show streaming provider name (Netflix, YouTube TV, etc.) in detail sheet
- [x] Remove tracked items via long-press on card or detail sheet button
- [x] FlatList key prop fix for search mode switching (numColumns change crash)

---

### Phase 2: TV Platforms + Video Player + Infrastructure ✅ NEAR COMPLETE

**Goal**: Adapt the app for 10-foot UI on Android TV, add built-in video player, WebSocket realtime updates, backend service management, standalone builds, and CI/CD.

#### 2.1 — TV Navigation System ✅ COMPLETE
- [x] D-pad focus management using react-native-tvos focus engine
- [x] Focus highlight styling (gold border `#E5A00D` on focused cards)
- [x] Focus memory per row (horizontal scroll auto-follows focus)
- [x] Cross-shelf vertical navigation via `nextFocusUp`/`nextFocusDown` node IDs
- [x] Edge trapping (first/last card in row wraps `nextFocusLeft`/`nextFocusRight` to self)
- [x] Back button handling per tab (scrolls to top + focuses first card, prevents app exit)
- [x] Tab-scoped back handlers via `useIsFocused()` — only active tab processes back press
- [x] `TVPressable` wrapper component with focus border styling
- [x] `TVTextInput` component with TV keyboard handling
- [x] `TVTabButton` — switches tabs on focus (not just press) for D-pad navigation

#### 2.2 — TV Layout Adaptations ✅ COMPLETE
- [x] Top horizontal tab bar on TV (bottom on phone)
- [x] Larger cards with TV-appropriate spacing (160x240px on TV vs 140x210px on phone)
- [x] Safe area compliance (48px horizontal, 27px vertical)
- [x] Typography scaling (28px title, 18px body on TV)
- [x] Card peeking at shelf edges
- [x] Responsive column count on Library grid based on screen width
- [x] Clock overlay in upper-right corner (updates every second, 12-hour format)
- [x] Tab bar right-padding to accommodate clock

#### 2.3 — TV-Specific Interactions ✅ COMPLETE
- [x] Long-press on card → context menu (Mark as Watched, Mark All as Watched, Remove from Watchlist)
- [x] Smooth horizontal scroll on card focus
- [x] Vertical scroll snapping to show full rows (Library grid)
- [x] `scrollEnabled={false}` on TV FlatLists with manual scroll control

#### 2.4 — Performance Optimization for TV ✅ COMPLETE
- [x] Image disk caching via expo-image (`cachePolicy="disk"`)
- [x] FlatList tuning: `windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews`
- [x] Library cards manage own focus state internally (prevents FlatList full re-render on focus change)
- [x] `React.memo` on card components

#### 2.5 — Built-in Video Player ✅ COMPLETE
- [x] HLS streaming via expo-video with quality selection
- [x] 9 bitrate presets (1.5–20 Mbps + original/direct play)
- [x] Seamless mid-playback quality switching with position resume
- [x] TV-optimized controls: D-pad seek (left/right ±10s), progress bar scrubbing (±30s)
- [x] Control buttons: stop, rewind 30s, play/pause, forward 30s, quality picker
- [x] Auto-hide controls after 5 seconds of inactivity
- [x] Seek direction indicator overlay
- [x] Progress reporting to Plex every 10 seconds
- [x] Session management (transcode lifecycle)
- [x] Resume from saved position (viewOffset)
- [x] Auto-close when video ends
- [x] Suppress realtime updates during playback (prevents stale data overwriting position)
- [x] `useTVEventHandler` for D-pad when controls hidden
- [x] `hasTVPreferredFocus` on play button for initial focus

#### 2.6 — Backend: Playback API ✅ COMPLETE
- [x] `GET /api/playback/:ratingKey` — stream URL with HLS transcode parameters
- [x] `POST /api/playback/progress` — report playback position
- [x] `POST /api/playback/stop` — stop transcode session
- [x] Direct play vs direct stream vs full transcode modes
- [x] Subtitle and audio track extraction from Plex metadata
- [x] Quality parameters: maxBitrate, resolution, forceTranscode

#### 2.7 — Backend: Artwork Proxy ✅ COMPLETE
- [x] `GET /api/artwork?url=...` — proxy images through backend
- [x] Server-side caching (24-hour TTL)
- [x] Handles Plex auth tokens transparently
- [x] Content-Type detection

#### 2.8 — Backend: Library Endpoint ✅ COMPLETE
- [x] `GET /api/library/:type` — returns all movies or shows from Plex
- [x] Proxied artwork URLs
- [x] Library tab with toggle between TV Shows and Movies

#### 2.9 — WebSocket / Realtime Updates ✅ COMPLETE
- [x] WebSocket server on `/ws` path
- [x] Background polling every 60 seconds (when clients connected)
- [x] Data hash comparison to detect changes
- [x] Broadcasts invalidation events with React Query keys
- [x] `notifyDataChanged()` called after mutations (mark watched, add tracked, etc.)
- [x] Client: auto-reconnect every 5 seconds on disconnect
- [x] Client: reconnects on app resume (AppState listener)
- [x] Client: suppression flag during playback with pending queue + flush

#### 2.10 — Cross-Platform Service Installer ✅ COMPLETE
- [x] **Windows**: NSSM (Non-Sucking Service Manager) — auto-downloads if needed
  - Auto-start on boot, environment from `.env`, stdout/stderr to log file
- [x] **Linux**: systemd unit file — restart on failure, journalctl logging
- [x] **macOS**: launchd plist — RunAtLoad + KeepAlive, logs to ~/Library/Logs

#### 2.11 — File-Based Logging ✅ COMPLETE
- [x] Platform-aware log paths (Windows: ProgramData, macOS: ~/Library/Logs, Linux: /var/log)
- [x] Multi-fallback strategy (ProgramData → exe dir → temp dir)
- [x] Intercepts console.log/warn/error + uncaught exceptions
- [x] ISO timestamp + log level format
- [x] `LOG_FILE` env var override

#### 2.12 — Standalone Build (Node.js SEA) ✅ COMPLETE
- [x] esbuild bundles TypeScript + all dependencies to single CJS file
- [x] Node.js Single Executable Application (SEA) blob generation
- [x] Inject into Node binary via postject
- [x] macOS code signature handling (remove + re-sign ad-hoc)
- [x] `--skip-sea` flag for bundle-only mode
- [x] Outputs: `whatson-api.exe` (Windows), `whatson-api` (Linux/macOS)
- [x] Lazy config via Proxy to handle esbuild bundle ordering (dotenv loads before config)

#### 2.13 — Separate Phone & TV Build Configurations ✅ COMPLETE
- [x] Dynamic `app.config.ts` with `WHATSON_TV` environment variable
- [x] Separate packages: `com.whatson.app` (phone) vs `com.whatson.tv` (TV)
- [x] TV build: `androidTVRequired=true`, TV banner asset (320x180px)
- [x] Phone build: standard mobile config
- [x] `WHATSON_TV=1 npx expo run:android` for TV build

#### 2.14 — CI/CD Pipeline (Azure DevOps) ✅ COMPLETE
- [x] Multi-stage pipeline: backend build → Linux installers → phone AAB → TV AAB
- [x] Backend standalone executable + Linux packages (.deb, .rpm) via fpm
- [x] Signed Android AAB for phone (`com.whatson.app`)
- [x] Signed Android AAB for TV (`com.whatson.tv`)
- [x] Auto-install Java 17 + Android SDK (platform 36, build-tools 36.0.0)
- [x] Keystore signing via pipeline secrets
- [x] Python script for Gradle signing patch (`scripts/patch-signing.py`)
- [x] Manual trigger (no continuous build)

#### 2.15 — Remaining Items
- [ ] Apple TV (tvOS) testing and polish — code supports it via react-native-tvos but untested
- [ ] Card focus expansion on TV: show summary snippet, episode info on focus (planned but not implemented)

#### 2.16 — Web Admin UI ⬜ NOT STARTED
**Goal**: Browser-based setup and configuration served by the backend itself at `http://server:3001/setup`.
Users open this from any device with a browser to configure the backend — no manual `.env` editing required.

- [ ] Static HTML/JS admin app served by Express (e.g., `/setup` route)
- [ ] **Plex OAuth PIN flow**:
  - Backend requests PIN from `plex.tv/api/v2/pins`
  - Admin UI opens Plex auth page in browser with PIN code
  - Backend polls for auth token completion
  - Token saved to config (`.env` or `data/config.json`)
- [ ] **Sonarr configuration**: URL + API key entry with "Test Connection" button
- [ ] **Radarr configuration**: URL + API key entry with "Test Connection" button
- [ ] **TMDB API key** (optional): entry with validation
- [ ] **Connection status dashboard**: green/red indicators for each service
- [ ] **Backend restart** after config changes (or hot-reload config)
- [ ] First-run detection: if no config exists, redirect API clients to setup URL
- [ ] Mobile/TV app: show "Configure server at http://x.x.x.x:3001/setup" message when backend has no config

---

### Phase 3: Windows + Live TV ⬜ NOT STARTED

**Goal**: Add Windows desktop support and live TV guide integration.

#### 3.1 — Windows App
- [ ] Configure react-native-windows build target
- [ ] Desktop-appropriate layout (sidebar navigation, larger content area)
- [ ] Keyboard + mouse navigation support
- [ ] Window resizing and responsive breakpoints
- [ ] System tray / taskbar integration (optional)
- [ ] Windows installer (MSIX or electron-style)

#### 3.2 — Live TV / EPG Integration
- [ ] Backend: TVmaze service
  - Fetch `/schedule?country={cc}&date={today}` for tonight's broadcasts
  - Cache schedule data (60-min TTL matching TVmaze CDN cache)
  - Match TVmaze shows against Sonarr tracked series
- [ ] Backend: TMDB metadata enrichment
  - Fetch additional artwork and metadata for shows/movies
  - Supplement TVmaze data with high-quality posters
- [ ] Endpoint: `GET /api/live/tonight` — what's on TV tonight
- [ ] Endpoint: `GET /api/live/now` — currently airing
- [ ] **Live TV Tab** in app:
  - "On Now" shelf — currently airing shows from tracked channels
  - "Tonight" shelf — upcoming broadcasts tonight, sorted by time
  - Show channel name, air time, episode info
  - Highlight shows that match Sonarr watchlist

#### 3.3 — Favorite Channels
- [ ] Settings: configure favorite TV channels (from TVmaze channel list)
- [ ] Filter live TV data to only show favorite channels
- [ ] "Where to Watch" indicator on cards — Plex, Live (channel name), Sonarr (downloading)

**Phase 3 Deliverable**: Windows app + Live TV guide integration showing tonight's schedule.

---

### Phase 4: Enhanced Features ⬜ NOT STARTED

**Goal**: Add calendar, notifications, Trakt sync, content requests, and multi-user support.

#### 4.1 — Calendar View
- [ ] Backend: `GET /api/calendar?start={date}&end={date}` — merge Sonarr calendar + Radarr calendar + TVmaze schedule
- [ ] **Calendar Screen** (new tab or accessible from Coming Soon):
  - Weekly view (default) with daily columns
  - Monthly view toggle
  - Color-coded by source (Sonarr=blue, Radarr=red, Live=green)
  - Tap/select day → show items for that day
  - Each item shows: poster thumbnail, title, episode info, expected time

#### 4.2 — Push Notifications
- [ ] Backend: notification service using Firebase Cloud Messaging (Android/Android TV) and APNs (iOS/tvOS)
- [ ] Notification triggers:
  - New episode downloaded (Sonarr history polling or webhook)
  - New movie downloaded (Radarr history polling or webhook)
  - Show returns from hiatus (Sonarr calendar)
  - Content request fulfilled (Overseerr webhook)
- [ ] User preferences: toggle notifications per type, quiet hours
- [ ] Windows: native toast notifications via react-native-windows

#### 4.3 — Trakt.tv Integration
- [ ] Backend: Trakt OAuth2 authentication flow
- [ ] Sync watch history: Plex → Trakt (bidirectional)
- [ ] Import Trakt watchlist as "Want to Watch" section
- [ ] Display Trakt ratings alongside Plex ratings
- [ ] Endpoint: `GET /api/trakt/recommendations` — personalized suggestions based on history

#### 4.4 — Content Request Integration (Overseerr/Ombi)
- [ ] Backend: Overseerr API proxy service
  - `POST /api/request` — submit content request
  - `GET /api/request/status` — check request status
- [ ] Search enhancement: when content is not available, show "Request" button
- [ ] Request status tracking: show pending requests in a "Requested" section
- [ ] Notification when request is approved/available

#### 4.5 — Multi-User Profiles
- [ ] Backend: user/profile management (link to Plex managed users)
- [ ] Profile selection screen on app launch (or auto-login)
- [ ] Per-profile watch state, preferences, and notification settings
- [ ] Profile avatars (from Plex or custom)

#### 4.6 — Recommendations Engine
- [ ] Backend: `GET /api/recommendations` — generate suggestions
  - Based on: watch history genres, TMDB "similar" API, Trakt recommendations
  - Filter out already-watched content
- [ ] "Recommended for You" shelf on Home screen
- [ ] "Because you watched [X]" row labels

#### 4.7 — Home Screen Widgets
- [ ] Android widget: "Up Next" showing next unwatched episode (react-native widget or native module)
- [ ] iOS widget: "Up Next" + "New Downloads" using WidgetKit (native Swift module)
- [ ] Widget tap → deep link into app to the specific content

#### 4.8 — Quick Actions
- [ ] Mobile: swipe gestures on cards (swipe right = mark watched, swipe left = add to watchlist)
- [ ] TV: dedicated remote button mappings (e.g., play button = start playback, info button = details)
- [ ] 3D Touch / Haptic Touch quick actions on iOS app icon

**Phase 4 Deliverable**: Full-featured app with calendar, notifications, Trakt, content requests, profiles, recommendations, and widgets.

---

### Phase 5: Roku + Polish ⬜ NOT STARTED

**Goal**: Roku channel development and overall app polish.

#### 5.1 — Roku Channel Development
- [ ] Set up Roku development environment (Roku Developer Kit, sideloading)
- [ ] BrightScript/SceneGraph project structure using SGDEX
- [ ] Authentication flow (enter code on phone/web to link account)
- [ ] Home screen with horizontal content shelves (RowList component)
- [ ] Card design: poster, title, source badge, progress bar
- [ ] Detail screen: full metadata, Mark as Watched, Play (launches Plex)
- [ ] TV Shows and Movies sections
- [ ] Search with grid keyboard + voice search
- [ ] D-pad navigation and focus management
- [ ] Connect to same backend API as React Native apps
- [ ] Roku Channel Store submission

#### 5.2 — Smart Collections
- [ ] Backend: auto-generated collections
  - "Quick Watch" — movies under 90 minutes
  - "Binge-worthy" — shows with 3+ seasons fully available
  - "New This Week" — added in last 7 days
  - "Leaving Soon" — if applicable
- [ ] Display as additional shelves on Home/TV/Movies screens

#### 5.3 — Statistics Dashboard
- [ ] Backend: aggregate watch history data
  - Watch time per day/week/month
  - Top genres, shows, movies
  - Completion rates
- [ ] **Stats Screen** (accessible from profile/settings)
  - Bar charts for watch time
  - Top content lists
  - "Year in Review" style summary

#### 5.4 — Companion Mode
- [ ] WebSocket connection between mobile and TV app
- [ ] Phone acts as remote control for TV app
- [ ] Phone keyboard input for TV search
- [ ] QR code pairing between devices

#### 5.5 — Watch Party (Experimental)
- [ ] Synchronized playback state via WebSocket
- [ ] Text chat overlay
- [ ] Participant management (invite via link/code)
- [ ] Works across all platforms

#### 5.6 — Full EPG Grid
- [ ] Traditional cable-style grid view for Live TV tab
- [ ] Channel rows × time columns
- [ ] Current time indicator
- [ ] 30-min/1-hr/2-hr zoom levels
- [ ] Scrollable in both directions
- [ ] Program details on focus/select

#### 5.7 — Deep Linking
- [ ] Universal links (iOS) and app links (Android)
- [ ] Notification tap → specific content detail screen
- [ ] Widget tap → specific content or playback
- [ ] URL scheme: `whatson://content/{id}`

#### 5.8 — Performance & Polish
- [ ] Offline support: cache last-known state for instant launch
- [ ] Animation polish: smooth transitions, card animations
- [ ] Accessibility: screen reader support, high contrast mode
- [ ] Localization framework (i18n) for future language support
- [ ] Error recovery: graceful degradation when services are unreachable
- [ ] Analytics integration (optional, privacy-respecting)

**Phase 5 Deliverable**: Roku channel, smart collections, stats, companion mode, and polished experience.

---

## Feature Breakdown Matrix

| Feature | Phase | Platforms | Priority | Status |
|---------|-------|-----------|----------|--------|
| Plex integration (On Deck, Recently Added) | 1 | All | Core | ✅ Done |
| Plex auto-discover via plex.tv | 1 | All | Core | ✅ Done |
| Sonarr integration (upcoming, downloads) | 1 | All | Core | ✅ Done |
| Radarr integration (movies, downloads) | 1 | All | Core | ✅ Done |
| Mark as Watched / Unwatched | 1 | All | Core | ✅ Done |
| Search (TV + Movies) | 1 | All | Core | ✅ Done |
| Horizontal scrolling shelves | 1 | All | Core | ✅ Done |
| In-progress items first | 1 | All | Core | ✅ Done |
| Hide completed/watched items | 1 | All | Core | ✅ Done |
| TV Shows tab (Ready + Coming Soon) | 1 | All | Core | ✅ Done |
| Movies tab (Recent + Coming Soon) | 1 | All | Core | ✅ Done |
| Source badges (Plex/Live/Sonarr) | 1 | All | Core | ✅ Done |
| Progress bar on cards | 1 | All | Core | ✅ Done |
| Unified aggregation + caching | 1 | All | Core | ✅ Done |
| Health check + config endpoints | 1 | All | Core | ✅ Done |
| Cross-source watch state merging | 1 | All | Core | ✅ Done |
| Loading skeletons + error states | 1 | All | Core | ✅ Done |
| Settings page with server config | 1.5 | All | Core | ✅ Done |
| TMDB discovery search | 1.5 | All | Core | ✅ Done |
| Tracked items / Watchlist | 1.5 | All | Core | ✅ Done |
| Streaming provider picker (13 providers) | 1.5 | All | Core | ✅ Done |
| Plex local connection preference | 1.5 | All | Core | ✅ Done |
| Ready to Watch = Plex only | 1.5 | All | Core | ✅ Done |
| Artwork proxy + disk caching | 1.5 | All | Core | ✅ Done |
| TMDB search + Sonarr/Radarr fallback | 1.5 | All | Core | ✅ Done |
| Remove tracked items (long-press + detail) | 1.5 | All | Core | ✅ Done |
| Coming Soon date overlay on cards | 1.5 | All | Core | ✅ Done |
| Continue Watching deduplication | 1.5 | All | Core | ✅ Done |
| Android Modal detail sheet fix | 1.5 | Android | Core | ✅ Done |
| Android TV D-pad focus management | 2 | Android TV | Core | ✅ Done |
| TV top tab bar + TVTabButton (focus-switch) | 2 | TV | Core | ✅ Done |
| Cross-shelf vertical navigation | 2 | TV | Core | ✅ Done |
| TV back button handling (per-tab) | 2 | TV | Core | ✅ Done |
| TV card sizing + safe area + typography | 2 | TV | Core | ✅ Done |
| Clock overlay | 2 | TV | Core | ✅ Done |
| Built-in video player (expo-video) | 2 | All | Core | ✅ Done |
| TV player controls (D-pad seek, quality) | 2 | TV | Core | ✅ Done |
| HLS transcode + quality selection | 2 | All | Core | ✅ Done |
| Playback progress reporting to Plex | 2 | All | Core | ✅ Done |
| Library tab (grid browser) | 2 | All | Core | ✅ Done |
| WebSocket realtime updates | 2 | All | Core | ✅ Done |
| Playback suppression of realtime updates | 2 | All | Core | ✅ Done |
| Cross-platform service installer | 2 | Backend | Core | ✅ Done |
| File-based logging | 2 | Backend | Core | ✅ Done |
| Standalone build (Node.js SEA) | 2 | Backend | Core | ✅ Done |
| Separate phone/TV build configs | 2 | Android | Core | ✅ Done |
| Azure DevOps CI/CD pipeline | 2 | All | Core | ✅ Done |
| Linux installers (.deb, .rpm) | 2 | Backend | Core | ✅ Done |
| Apple TV testing + polish | 2 | tvOS | Core | ⬜ Todo |
| Card focus expansion (summary on focus) | 2 | TV | Medium | ⬜ Todo |
| Web Admin UI (Plex OAuth + service config) | 2 | Backend | Medium | ⬜ Todo |
| Sonarr/Radarr ↔ Plex watch state merge | 1 | All | Medium | ⬜ Todo |
| Windows desktop app | 3 | Windows | Core | ⬜ Todo |
| Live TV schedule (TVmaze) | 3 | All | Core | ⬜ Todo |
| Favorite channels | 3 | All | Core | ⬜ Todo |
| Calendar view | 4 | All | High | ⬜ Todo |
| Push notifications | 4 | Mobile + TV | High | ⬜ Todo |
| Trakt.tv sync | 4 | All | High | ⬜ Todo |
| Content requests (Overseerr) | 4 | All | High | ⬜ Todo |
| Multi-user profiles | 4 | All | Medium | ⬜ Todo |
| Recommendations engine | 4 | All | Medium | ⬜ Todo |
| Home screen widgets | 4 | Android + iOS | Medium | ⬜ Todo |
| Quick actions (swipe, remote buttons) | 4 | All | Medium | ⬜ Todo |
| Roku channel | 5 | Roku | Core | ⬜ Todo |
| Smart collections | 5 | All | Medium | ⬜ Todo |
| Statistics dashboard | 5 | All | Low | ⬜ Todo |
| Companion mode | 5 | Mobile + TV | Low | ⬜ Todo |
| Watch party | 5 | All | Low | ⬜ Todo |
| Full EPG grid | 5 | All | Low | ⬜ Todo |
| Deep linking | 5 | All | Medium | ⬜ Todo |

---

## Tech Stack Summary

| Layer | Technology | Rationale | Status |
|-------|-----------|-----------|--------|
| **Monorepo** | npm workspaces | Native, zero-config, sufficient for this project | ✅ Set up |
| **Backend** | Node.js + Express + TypeScript | Same language as frontend; good API client libs | ✅ Set up |
| **Cache** | In-memory (node-cache) | Simple, fast, no external dependencies | ✅ Set up |
| **Realtime** | WebSocket (ws) | Background polling + client invalidation | ✅ Set up |
| **Mobile/TV App** | React Native + Expo (react-native-tvos) | 5 platforms from 1 codebase (+ Expo Router) | ✅ Set up |
| **Video Player** | expo-video | Native HLS playback with quality control | ✅ Set up |
| **State/Data** | TanStack Query + Zustand | React Query for API, Zustand for app state | ✅ Set up |
| **Shared Types** | @whatson/shared package | TypeScript types + constants shared across packages | ✅ Set up |
| **Standalone** | esbuild + Node.js SEA | Zero-dependency single executable | ✅ Set up |
| **Service Mgmt** | NSSM / systemd / launchd | Cross-platform daemon management | ✅ Set up |
| **Logging** | Custom file logger | Platform-aware paths with fallbacks | ✅ Set up |
| **CI/CD** | Azure DevOps Pipelines | Multi-stage: backend + phone AAB + TV AAB | ✅ Set up |
| **Windows App** | react-native-windows | Microsoft-maintained, same codebase | ⬜ Phase 3 |
| **Roku** | BrightScript + SceneGraph + SGDEX | Only option for Roku | ⬜ Phase 5 |
| **Database** | SQLite → PostgreSQL | For profiles, preferences (Phase 4+) | ⬜ Phase 4 |
| **Notifications** | Firebase Cloud Messaging + APNs | Industry standard | ⬜ Phase 4 |
| **Live TV Data** | TVmaze API (free) | Best free broadcast schedule API | ⬜ Phase 3 |
| **Watch Tracking** | Trakt.tv API (free) | Cross-platform watch history sync | ⬜ Phase 4 |

---

## Files Created

```
whatson/
├── .gitignore
├── .prettierrc
├── package.json                          # npm workspaces root
├── tsconfig.base.json                    # Shared TS config
├── azure-pipelines.yml                   # CI/CD pipeline (4 stages)
├── research.md                           # Full research document
├── plan.md                               # This file
├── icon.ico                              # App icon
├── scripts/
│   ├── build-standalone.js              # esbuild + Node.js SEA builder
│   └── patch-signing.py                 # Gradle signing patch for CI
├── apps/
│   └── mobile/
│       ├── package.json
│       ├── tsconfig.json
│       ├── app.json                      # Expo config (static)
│       ├── app.config.ts                 # Dynamic Expo config (phone vs TV)
│       ├── assets/
│       │   └── tv-banner.png            # Android TV banner (320x180)
│       ├── constants/
│       │   └── theme.ts                  # Dark theme, colors, typography, card sizes (phone + TV)
│       ├── lib/
│       │   ├── api.ts                    # API client (fetch wrapper + artwork URL resolver)
│       │   ├── store.ts                  # Zustand store
│       │   ├── tv.ts                     # TV detection (isTV, isTVOS, isAndroidTV)
│       │   ├── useBackHandler.ts         # TV back button handler (tab-scoped via useIsFocused)
│       │   └── useRealtimeUpdates.ts     # WebSocket client (auto-reconnect, suppression, queue)
│       ├── components/
│       │   ├── ContentCard.tsx           # Poster card with badge, progress, D-pad focus, long-press
│       │   ├── ContentShelf.tsx          # Horizontal scrolling row with cross-shelf focus
│       │   ├── ShelfList.tsx             # Multi-shelf container with focusFirst() imperative handle
│       │   ├── DetailSheet.tsx           # Modal with full metadata + actions
│       │   ├── ProgressBar.tsx           # Thin progress indicator
│       │   ├── SourceBadge.tsx           # Color-coded source pill
│       │   ├── SkeletonCard.tsx          # Loading skeleton shimmer
│       │   ├── ErrorState.tsx            # Error display with retry
│       │   ├── Clock.tsx                 # Real-time clock overlay (TV)
│       │   └── TVFocusable.tsx           # TVPressable + TVTextInput wrappers
│       └── app/
│           ├── _layout.tsx               # Root layout (QueryClientProvider, realtime updates)
│           ├── player.tsx                # Built-in video player (expo-video, TV controls)
│           └── (tabs)/
│               ├── _layout.tsx           # Tab navigator (TV top bar, clock, TVTabButton)
│               ├── index.tsx             # Home screen
│               ├── tv.tsx                # TV Shows screen
│               ├── movies.tsx            # Movies screen
│               ├── library.tsx           # Library browser (grid, TV 2-row layout)
│               ├── search.tsx            # Search (Library + Discover modes)
│               └── settings.tsx          # Settings (server config, connection status)
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts                  # ContentItem, ServerConfig, API types
│   │       └── constants.ts              # App name, streaming providers, API base URLs
│   └── api/
│       ├── package.json
│       ├── tsconfig.json
│       ├── nssm.exe                      # NSSM binary for Windows service management
│       ├── .env.example                  # Documented config with local/remote options
│       └── src/
│           ├── index.ts                  # Express server entry (dotenv multi-path, WS init)
│           ├── config.ts                 # Lazy config via Proxy (for esbuild compatibility)
│           ├── cache.ts                  # In-memory cache (node-cache)
│           ├── ws.ts                     # WebSocket server (60s polling, data hash, broadcast)
│           ├── logger.ts                 # File logger (platform-aware paths, fallbacks)
│           ├── service.ts                # Cross-platform service installer (NSSM/systemd/launchd)
│           ├── services/
│           │   ├── plex.ts               # Plex service (plex.tv discovery, local-first, lock)
│           │   ├── sonarr.ts             # Sonarr service (calendar, history, queue, toArray)
│           │   ├── radarr.ts             # Radarr service (movies, history, queue)
│           │   └── aggregator.ts         # Merges all sources into home/search responses
│           └── routes/
│               ├── health.ts             # GET /api/health
│               ├── home.ts               # GET /api/home
│               ├── tv.ts                 # GET /api/tv/*
│               ├── movies.ts             # GET /api/movies/*
│               ├── library.ts            # GET /api/library/:type
│               ├── search.ts             # GET /api/search
│               ├── discover.ts           # GET /api/discover/search
│               ├── artwork.ts            # GET /api/artwork (proxy + cache)
│               ├── playback.ts           # GET/POST /api/playback/* (stream, progress, stop)
│               ├── scrobble.ts           # POST /api/scrobble, /api/unscrobble
│               ├── add.ts                # POST /api/add (tracked items)
│               ├── config.ts             # GET/POST /api/config
│               └── debug.ts              # GET /api/debug
```

---

## How to Run

**Backend API:**
```bash
cd packages/api
cp .env.example .env     # Edit with your server details
npm run dev:api           # From repo root, or: npx tsx watch src/index.ts
```

**Mobile App (Phone):**
```bash
npm run dev:mobile        # From repo root, or: cd apps/mobile && npx expo start
```

**Mobile App (Android TV):**
```bash
cd apps/mobile
WHATSON_TV=1 npx expo run:android
```

**Standalone Backend:**
```bash
node scripts/build-standalone.js    # Outputs whatson-api.exe / whatson-api
```

**Install as Service:**
```bash
node packages/api/src/service.ts install    # Detects OS, installs appropriate service
```

Set `EXPO_PUBLIC_API_URL` in the mobile app environment to point to your backend (defaults to `http://localhost:3001/api`).

---

## Not Yet Implemented

### From Phase 1 (deferred):
1. **Sonarr/Radarr ↔ Plex watch state merging** — matching by series/episode across sources

### From Phase 2 (remaining):
2. **Web Admin UI** — browser-based setup at `http://server:3001/setup` with Plex OAuth PIN flow, Sonarr/Radarr config entry, connection testing. Replaces manual `.env` editing and the deferred onboarding/OAuth items from Phase 1.
3. **Apple TV (tvOS) testing & polish** — code supports it via react-native-tvos but untested on real hardware
4. **Card focus expansion** — show summary snippet / episode info when card is focused on TV

### Phase 3 (not started):
5. **Windows desktop app** — react-native-windows build target
6. **Live TV / EPG integration** — TVmaze schedule, "On Now" / "Tonight" shelves
7. **Favorite channels** — filter live TV to preferred channels

### Phase 4 (not started):
8. **Calendar view** — merged Sonarr + Radarr + TVmaze calendar
9. **Push notifications** — FCM/APNs for new downloads, show returns
10. **Trakt.tv sync** — bidirectional watch history, recommendations
11. **Overseerr/Ombi content requests** — request missing content
12. **Multi-user profiles** — Plex managed users, per-profile state
13. **Recommendations engine** — "Because you watched X" shelves
14. **Home screen widgets** — Android/iOS "Up Next" widgets
15. **Quick actions** — swipe gestures, remote button mappings

### Phase 5 (not started):
16. **Roku channel** — BrightScript/SceneGraph native app
17. **Smart collections** — auto-generated "Quick Watch", "Binge-worthy", etc.
18. **Statistics dashboard** — watch time charts, top content
19. **Companion mode** — phone as TV remote
20. **Watch party** — synchronized playback
21. **Full EPG grid** — traditional cable-style grid view
22. **Deep linking** — universal links, URL scheme `whatson://content/{id}`
23. **Performance & polish** — offline cache, accessibility, i18n, animations
