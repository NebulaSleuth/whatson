# "Whats On" — Implementation Plan

> **Last Updated**: 2026-03-19
> **Current Phase**: Phase 2 — TV Platform Support
> **Overall Progress**: Phase 1 + 1.5 complete, starting Phase 2

---

## Status Summary

| Phase | Status | Progress |
|-------|--------|----------|
| **Phase 1**: Foundation (Backend + Mobile) | **Complete** | ██████████████ 100% |
| **Phase 1.5**: Discovery & Tracking | **Complete** | ██████████████ 100% |
| **Phase 2**: TV Platforms (Android TV + Apple TV) | **In Progress** | ░░░░░░░░░░░░░░ 0% |
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
│  │ Plex        │ │ Sonarr      │ │ Radarr   │ │ EPG          │  │
│  │ Service     │ │ Service     │ │ Service  │ │ Service      │  │
│  │ (plex.tv    │ │             │ │          │ │ (TVmaze+TMDB)│  │
│  │  discovery) │ │             │ │          │ │              │  │
│  └──────┬──────┘ └──────┬──────┘ └────┬─────┘ └──────┬───────┘  │
│         │               │             │               │          │
│  ┌──────┴───────────────┴─────────────┴───────────────┴───────┐  │
│  │                    Unified Data Layer                       │  │
│  │  • Normalize content from all sources                      │  │
│  │  • Merge watch state + availability + schedules            │  │
│  │  • Cache layer (in-memory via node-cache)                  │  │
│  │  • WebSocket for real-time updates (Phase 4+)              │  │
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
              │               │            │              │
              ▼               ▼            ▼              ▼
        ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────┐
        │ Plex     │  │ Sonarr    │  │ Radarr   │  │ TVmaze   │
        │ Server   │  │ Server    │  │ Server   │  │ API      │
        │(local or │  │(local or  │  │(local or │  │ (cloud)  │
        │ remote)  │  │ remote)   │  │ remote)  │  │          │
        └──────────┘  └───────────┘  └──────────┘  └──────────┘
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

### Phase 1: Foundation (Backend + Core Mobile App) — IN PROGRESS

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
- [ ] Plex OAuth PIN authentication flow (currently uses static token)

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

#### 1.7 — Setup/Onboarding Flow ⬜ NOT STARTED
- [ ] First-run configuration screen
- [ ] Plex OAuth login flow (opens browser → redirects back)
- [ ] Sonarr URL + API key entry with connection test
- [ ] Radarr URL + API key entry with connection test
- [ ] Settings screen to modify connections later

**Phase 1 Deliverable**: Working Android + iOS app showing Plex/Sonarr/Radarr content with mark-as-watched functionality and search.

**Remaining for Phase 1**:
- Onboarding first-run redirect (1.7) — deferred, Settings tab serves this purpose
- Plex OAuth flow (1.2) — deferred, token-based auth works for now

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

### Phase 2: TV Platform Support (Android TV + Apple TV) ⬜ NOT STARTED

**Goal**: Adapt the app for 10-foot UI on Android TV and Apple TV.

#### 2.1 — TV Navigation System
- [ ] Implement D-pad focus management using react-native-tvos focus engine
- [ ] Focus highlight styling (scale 1.1x + border glow)
- [ ] Focus memory per row (remember horizontal scroll position)
- [ ] TVFocusGuideView for non-aligned elements
- [ ] Back button handling (Detail → Row → Home → Exit confirmation)
- [ ] Remote menu/options button → context menu

#### 2.2 — TV Layout Adaptations
- [ ] Top horizontal navigation bar (replace bottom tabs)
- [ ] Larger cards with TV-appropriate spacing
- [ ] Safe area compliance (48px sides, 27px top/bottom for Android TV; 90px/60px for tvOS)
- [ ] Typography scaling (minimum 24px body text)
- [ ] Peeking card at row edges
- [ ] 5-7 cards per row at 1080p

#### 2.3 — TV-Specific Interactions
- [ ] Long-press select → context menu (Mark as Watched, View Details)
- [ ] Card focus expansion: show summary snippet, episode info, duration on focus
- [ ] Smooth horizontal scroll animation on D-pad Left/Right
- [ ] Vertical row scroll with partial next-row preview

#### 2.4 — Performance Optimization for TV
- [ ] Image preloading and caching for visible + adjacent cards
- [ ] FlatList optimization: `windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews`
- [ ] Lazy loading for off-screen shelves
- [ ] Test and fix Android TV horizontal focus issues (known react-native-tvos issue)

**Phase 2 Deliverable**: Full Android TV and Apple TV support with proper 10-foot UI.

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
| Android TV support | 2 | Android TV | Core | ⬜ Todo |
| Apple TV support | 2 | tvOS | Core | ⬜ Todo |
| D-pad/remote navigation | 2 | TV | Core | ⬜ Todo |
| 10-foot UI adaptations | 2 | TV | Core | ⬜ Todo |
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
| **Mobile/TV App** | React Native + Expo | 5 platforms from 1 codebase (+ Expo Router) | ✅ Set up |
| **State/Data** | TanStack Query + Zustand | React Query for API, Zustand for app state | ✅ Set up |
| **Shared Types** | @whatson/shared package | TypeScript types + constants shared across packages | ✅ Set up |
| **Windows App** | react-native-windows | Microsoft-maintained, same codebase | ⬜ Phase 3 |
| **Roku** | BrightScript + SceneGraph + SGDEX | Only option for Roku | ⬜ Phase 5 |
| **Database** | SQLite → PostgreSQL | For profiles, preferences (Phase 4+) | ⬜ Phase 4 |
| **Notifications** | Firebase Cloud Messaging + APNs | Industry standard | ⬜ Phase 4 |
| **Live TV Data** | TVmaze API (free) | Best free broadcast schedule API | ⬜ Phase 3 |
| **Metadata** | TMDB API (free) | High-quality artwork and metadata | ⬜ Phase 3 |
| **Watch Tracking** | Trakt.tv API (free) | Cross-platform watch history sync | ⬜ Phase 4 |

---

## Files Created

```
whatson/
├── .gitignore
├── .prettierrc
├── package.json                          # npm workspaces root
├── tsconfig.base.json                    # Shared TS config
├── research.md                           # Full research document
├── plan.md                               # This file
├── apps/
│   └── mobile/
│       ├── package.json
│       ├── tsconfig.json
│       ├── app.json                      # Expo config
│       ├── constants/
│       │   └── theme.ts                  # Dark theme, colors, typography, card sizes
│       ├── lib/
│       │   ├── api.ts                    # API client (fetch wrapper)
│       │   └── store.ts                  # Zustand store
│       ├── components/
│       │   ├── ContentCard.tsx           # Poster card with badge, progress, long-press menu
│       │   ├── ContentShelf.tsx          # Horizontal scrolling row of cards
│       │   ├── DetailSheet.tsx           # Bottom sheet with full metadata + Mark as Watched
│       │   ├── ProgressBar.tsx           # Thin progress indicator
│       │   └── SourceBadge.tsx           # Color-coded source pill (Plex/Sonarr/Radarr/Live)
│       └── app/
│           ├── _layout.tsx               # Root layout (QueryClientProvider)
│           └── (tabs)/
│               ├── _layout.tsx           # Tab navigator (Home/TV/Movies/Search)
│               ├── index.tsx             # Home screen
│               ├── tv.tsx                # TV Shows screen
│               ├── movies.tsx            # Movies screen
│               └── search.tsx            # Search screen with filters
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts                  # ContentItem, ServerConfig, API types
│   │       └── constants.ts              # App name, colors, API base URLs
│   └── api/
│       ├── package.json
│       ├── tsconfig.json
│       ├── .env.example                  # Documented config with local/remote options
│       └── src/
│           ├── index.ts                  # Express server entry point
│           ├── config.ts                 # Environment config loader
│           ├── cache.ts                  # In-memory cache (node-cache)
│           ├── services/
│           │   ├── plex.ts               # Plex service (plex.tv discovery + direct URL)
│           │   ├── sonarr.ts             # Sonarr service (calendar, history, queue)
│           │   ├── radarr.ts             # Radarr service (movies, history, queue)
│           │   └── aggregator.ts         # Merges all sources into home/search responses
│           └── routes/
│               ├── health.ts             # GET /api/health
│               ├── home.ts               # GET /api/home
│               ├── tv.ts                 # GET /api/tv/*
│               ├── movies.ts             # GET /api/movies/*
│               ├── search.ts             # GET /api/search
│               ├── scrobble.ts           # POST /api/scrobble, /api/unscrobble
│               └── config.ts             # GET /api/config/status, POST /api/config/test
```

---

## How to Run

**Backend API:**
```bash
cd packages/api
cp .env.example .env     # Edit with your server details
npm run dev:api           # From repo root, or: npx tsx watch src/index.ts
```

**Mobile App:**
```bash
npm run dev:mobile        # From repo root, or: cd apps/mobile && npx expo start
```

Set `EXPO_PUBLIC_API_URL` in the mobile app environment to point to your backend (defaults to `http://localhost:3001/api`).

---

## Getting Started — Next Steps

1. **Complete Phase 1.7** — Build onboarding/settings flow so users can configure servers from the app
2. **Add Plex OAuth** — Replace static token with proper OAuth PIN flow for the mobile app
3. **Cross-source merging** — Match Sonarr/Radarr items with Plex watch state
4. **Loading/error states** — Add skeleton loaders and proper error UI
5. Then proceed to **Phase 2** (TV platforms) or **Phase 3** (Windows + Live TV)
