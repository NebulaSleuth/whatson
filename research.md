# "Whats On" — Research Report

## Executive Summary

"Whats On" is a media aggregation app that unifies Plex, Sonarr, Radarr, and live TV into a single "what can I watch tonight?" experience. This document covers APIs, cross-platform frameworks, UX patterns, and suggested enhancements.

---

## 1. API & Data Sources

### Plex Media Server

- **Auth**: X-Plex-Token (via `plex.tv` sign-in or OAuth PIN flow). Must include `X-Plex-Client-Identifier` header on all requests.
- **OAuth PIN Flow**:
  1. POST to `https://plex.tv/api/v2/pins` with `X-Plex-Client-Identifier` → returns `code` and `id`
  2. Redirect user to `https://app.plex.tv/auth#?clientID={clientId}&code={pinCode}&context[device][product]=WhatsOn`
  3. Poll `GET https://plex.tv/api/v2/pins/{id}` until `authToken` is returned
- **Key Endpoints** (base: `http://{PMS_IP}:32400`):

| Purpose | Endpoint | Notes |
|---------|----------|-------|
| On Deck | `GET /library/onDeck` | Partially watched + next episodes |
| Continue Watching | `GET /hubs` (hub with `hubIdentifier=home.continue`) | Global continue watching |
| Recently Added | `GET /library/recentlyAdded` | Capital 'A' required |
| Item Metadata | `GET /library/metadata/{ratingKey}` | Title, summary, duration, artwork |
| Children | `GET /library/metadata/{ratingKey}/children` | Seasons/episodes |
| Mark Watched | `GET /:/scrobble?key={ratingKey}&identifier=com.plexapp.plugins.library` | Uses GET (unusual) |
| Mark Unwatched | `GET /:/unscrobble?key={ratingKey}&identifier=com.plexapp.plugins.library` | |
| Update Progress | `GET /:/progress?key={ratingKey}&time={ms}&identifier=com.plexapp.plugins.library` | Sets viewOffset |
| Artwork (resized) | `GET /photo/:/transcode?url={thumbPath}&width={w}&height={h}` | On-the-fly resize |
| Search | `GET /search?query={q}` | Hub search across library |
| Active Sessions | `GET /status/sessions` | Currently playing |
| Watch History | `GET /status/sessions/history/all` | All viewing history |

- **Metadata Fields**: `title`, `summary`, `duration` (ms), `viewOffset` (progress ms), `viewCount`, `thumb`, `art`, `year`, `rating`, `grandparentTitle`/`parentTitle`/`title` (show>season>episode), `addedAt` (unix timestamp)
- **SDKs**: `@lukehagar/plexjs` (TypeScript), `python-plexapi` (Python), `plexcsharp` (.NET), `plexswift` (Swift), `plexgo` (Go)
- **Gotchas**:
  - Returns XML by default — add `Accept: application/json` header
  - `recentlyAdded` requires capital 'A' — lowercase returns 404
  - `viewOffset` only present on partially watched items
  - `plex.tv` endpoints have undocumented rate limits (HTTP 429); local PMS is not rate-limited
  - Scrobble/unscrobble use GET not POST

### Sonarr (TV Shows)

- **Auth**: API Key via `X-Api-Key` header or `?apikey=` query param (found in Settings > General)
- **API Version**: v3 and v4 both use `/api/v3/` prefix
- **Key Endpoints** (base: `http://{host}:{port}/api/v3`):

| Purpose | Endpoint | Key Parameters |
|---------|----------|----------------|
| Upcoming Episodes | `GET /calendar` | `start`, `end` (ISO 8601), `includeSeries`, `includeEpisodeFile`, `includeEpisodeImages` |
| All Series | `GET /series` | Returns images[], statistics |
| Single Series | `GET /series/{id}` | Full metadata |
| Episodes | `GET /episode` | `seriesId`, `seasonNumber`, `includeImages`, `includeSeries` |
| History | `GET /history` | `page`, `pageSize`, `sortKey`, `sortDirection`, `eventType` (1=Grabbed, 3=Downloaded) |
| Queue | `GET /queue` | Currently downloading |
| Missing | `GET /wanted/missing` | Monitored episodes without files |
| Series Artwork | `GET /mediacover/{seriesId}/{type}.jpg` | poster.jpg, banner.jpg, fanart.jpg |

- **Series Image Array**: Objects with `coverType` (poster/banner/fanart), `url` (local), `remoteUrl` (TVDB/TMDB)
- **Episode Fields**: `title`, `airDateUtc`, `airDate`, `seasonNumber`, `episodeNumber`, `overview`, `hasFile`
- **Gotchas**: Dates must be ISO 8601; `includeSeries=true` adds full series object (increases response size)

### Radarr (Movies)

- **Auth**: Same as Sonarr — API Key via `X-Api-Key` header
- **API Version**: `/api/v3/` prefix (both Radarr v4 and v5)
- **Key Endpoints** (base: `http://{host}:{port}/api/v3`):

| Purpose | Endpoint | Key Parameters |
|---------|----------|----------------|
| All Movies | `GET /movie` | Full movie list with metadata |
| Single Movie | `GET /movie/{id}` | Complete movie resource |
| Calendar | `GET /calendar` | `start`, `end`, `unmonitored`, `releaseTypes` (cinema/digital/physical) |
| History | `GET /history` | `page`, `pageSize`, `sortKey`, `eventType`, `movieIds` |
| History for Movie | `GET /history/movie` | `movieId` |
| Movie Files | `GET /moviefile` | `movieId` (int array) |

- **Movie Fields**: `title`, `overview`, `runtime` (minutes), `year`, `images[]`, `hasFile`, `isAvailable`, `monitored`, `added` (datetime), `physicalRelease`, `digitalRelease`, `inCinemas`, `tmdbId`, `imdbId`
- **Gotchas**:
  - No dedicated "recently added" endpoint — derive from history (eventType=imported) or filter movie list by `added` date
  - Calendar returns by release dates, not by add-to-library dates
  - Images reference TMDB CDN URLs

### Live TV / EPG Data

| Source | Coverage | Cost | Best For |
|--------|----------|------|----------|
| **TVmaze** `/schedule` | Broadcast/cable schedules by country/date | Free (20 req/10s) | "What's on tonight" |
| **TMDB** `/tv/airing_today` | Shows with episodes airing today | Free (API key required) | Metadata enrichment |
| **Plex Live TV** | EPG via Gracenote (Plex Pass + tuner) | Included with Plex Pass | If already using Plex Live TV |
| **Gracenote/TMS** | Industry-standard EPG | Commercial license | Overkill for personal use |
| **XMLTV / iptv-org/epg** | Community IPTV guides | Free | IPTV channel guides |

**TVmaze Key Endpoints**:
- `GET /schedule?country={cc}&date={YYYY-MM-DD}` — broadcast TV schedule
- `GET /schedule/web?country={cc}&date={YYYY-MM-DD}` — streaming schedule
- `GET /shows/{id}` — show details
- `GET /shows/{id}/images` — artwork
- Rate limit: 20 calls/10 seconds per IP; 60-minute CDN cache; CC BY-SA license

**Recommendation**: TVmaze for broadcast schedules + Sonarr calendar for tracked shows + TMDB for metadata/artwork enrichment.

---

## 2. Cross-Platform Framework Comparison

### Option A: React Native for TV (Recommended)

| Platform | Solution | Maturity |
|----------|----------|----------|
| Android | react-native-tvos | Stable |
| Android TV | react-native-tvos | Stable |
| iOS | react-native-tvos | Stable |
| Apple TV (tvOS) | react-native-tvos | Stable |
| Windows | react-native-windows (Microsoft) | Stable |
| **Roku** | **Separate codebase required** | N/A |

- 5 platforms from 1 TypeScript/React codebase + separate Roku channel
- Expo SDK 54 has full TV integration (Expo Router, dev client, CNG)
- Built-in focus engine integration for D-pad/remote navigation
- Largest community and most mature TV support of any framework
- Microsoft maintains react-native-windows; used internally for Xbox PC app
- **Risks**: Horizontal scrolling list focus issues on Android TV need optimization; fork tracks upstream closely but has inherent lag; react-native-windows has ~3-month support cycles per version

### Option B: Flutter

- No official TV support. tvOS requires community-maintained engine fork (fragile). D-pad navigation is manual via `RawKeyboardListener` + `FocusNode`. **Not recommended**.

### Option C: Kotlin Multiplatform + Compose

- Only covers Android TV for TV UI. tvOS, Windows, Roku need separate solutions. Defeats cross-platform purpose. **Not recommended as primary**.

### Option D: .NET MAUI

- No TV platform support exists or is planned. **Not viable**.

### Option E: Web-based (PWA/Electron/Tauri)

- Cannot cover TV platforms. Roku doesn't run web apps. **Not recommended as primary**.

### Roku — Separate Codebase Required

- Must use **BrightScript + SceneGraph** — no cross-platform framework targets Roku
- You.i TV (only solution that bridged React Native to Roku) was acquired by WarnerMedia in 2020 and is no longer commercially available
- Use **SGDEX** (SceneGraph Developer Extensions) for pre-built media browsing components
- Direct Publisher (no-code option) is too limited for custom UI
- Share the same backend APIs between React Native and Roku codebases

---

## 3. UX/UI Design Recommendations

### Layout Pattern

- **Horizontal content shelves** (Netflix/Plex pattern) — rows of cards scrolling left/right
- Partially visible "peeking" card on right edge signals more content
- 2:3 portrait posters for movies/shows, 16:9 landscape for episodes
- **Dark theme by default** — standard for all media apps

### Content Organization

**Home Screen Row Order:**
1. **Continue Watching** (in-progress items, sorted by last watched)
2. **Ready to Watch** (downloaded, available now)
3. **New Episodes Available**
4. **Recently Downloaded Movies**
5. **Coming Soon** (sorted by expected availability date)
6. **Live Now** (currently airing on tracked channels)

**Navigation Structure:**
- Tabs: **Home** | **TV Shows** | **Movies** | **Live TV** | **Search**
- Mobile: bottom tab bar
- Tablet: navigation rail (left side, collapsible)
- TV: top horizontal nav bar
- Desktop: sidebar or top nav

### Card Design

- **Default state**: Poster art + title only (minimal)
- **Focused/selected state**: Expand to show summary, episode info (S02E05), duration, source badge
- **Progress indicator**: Thin colored bar at bottom of poster (Plex convention)
- **Source badges**: Small color-coded pills — orange=Plex, blue=Sonarr, green=Live TV
- **Unwatched count**: Badge on corner showing number of new episodes
- **Watched**: Checkmark overlay or slightly dimmed

### TV-Specific (10-foot UI)

- Minimum 24px font for body text (18sp Android TV minimum)
- Safe areas: 48px sides, 27px top/bottom at 1080p (Google/Amazon); 90px sides, 60px top/bottom (Apple tvOS)
- Focus highlight: scale ~1.1x with visible border/glow
- D-pad: Up/Down between rows, Left/Right within rows
- Focus memory: remember horizontal position per row
- Back button: Detail → Row → Home → Exit (never trap user)

### Mark as Watched Interaction

- **Mobile**: Long-press card → context menu; or swipe gesture
- **TV**: Hold select button or press menu/options button → context menu overlay

### Search

- **Mobile**: Standard search bar with type-ahead autocomplete
- **TV**: Grid keyboard + **voice search** as primary (Android TV Assistant, Siri, Alexa)
- **Filters**: Chips for All | TV Shows | Movies | Live TV, plus source filters (Plex/Sonarr/Radarr)

### Responsive Card Counts

| Platform | Cards per row | Navigation |
|----------|--------------|------------|
| Phone (portrait) | 2-3 | Bottom tab bar |
| Phone (landscape) | 3-4 | Bottom tab bar |
| Tablet | 4-5 | Nav rail |
| Desktop/TV | 5-7 | Top bar or sidebar |

---

## 4. Suggested Enhancements

### High Priority (Core Adjacent)

| Enhancement | Description | Why |
|-------------|-------------|-----|
| Content Requests (Overseerr/Ombi) | Search for unavailable content → request → auto-flows to Sonarr/Radarr | Completes the discovery-to-acquisition loop |
| Calendar View | Weekly/monthly view of upcoming episodes and movie releases | Makes "Coming Soon" plannable |
| Push Notifications | Alert on new downloads, show returns, request fulfillment | Drives engagement without opening app |
| Trakt.tv Sync | Bidirectional watch history sync | Cross-platform watch state; enables recommendations |

### Medium Priority (Differentiators)

| Enhancement | Description |
|-------------|-------------|
| Multi-User Profiles | Different members see their own Continue Watching and recommendations |
| Recommendations Engine | "Because you watched X" using history + TMDB similar titles |
| Home Screen Widgets | Android/iOS widgets showing "Up Next" or "New Downloads" |
| Quick Actions | Swipe to mark watched (mobile), remote button mappings (TV) |

### Lower Priority (Nice to Have)

| Enhancement | Description |
|-------------|-------------|
| Watch Party | Synchronized playback with chat |
| Full EPG Grid | Traditional cable-style program guide for live TV |
| Smart Collections | Auto-generated: "Under 90 min", "Binge-worthy (3+ seasons)" |
| Statistics Dashboard | Watch time analytics (à la Tautulli) |
| Companion Mode | Phone as remote/keyboard for TV app |
| Deep Linking | Notifications/widgets → directly to content or playback |
| Offline Sync Indicators | Show which content is synced for offline (mobile) |

---

## 5. Reference Projects

| Project | What to Learn |
|---------|---------------|
| **Overseerr** | React UI for Plex/Sonarr/Radarr integration |
| **Pulsarr** | Real-time Plex watchlist monitoring, notifications |
| **Homarr** | Dashboard with calendar widget, multi-service integration |
| **nzb360** | Mobile Sonarr/Radarr management UX |
| **Apple TV app / Google TV** | Multi-source aggregator UX — closest commercial analog |
| **JustWatch / Reelgood** | Cross-platform content discovery |

---

## 6. Recommended Technical Stack

```
┌─────────────────────────────────────────────┐
│              Backend API Layer              │
│  (Node.js/Express or similar middleware)    │
│  Aggregates: Plex + Sonarr + Radarr + EPG  │
├────────────────────┬────────────────────────┤
│  React Native      │  Roku Channel          │
│  (TypeScript)      │  (BrightScript/        │
│                    │   SceneGraph)           │
│  • Android         │                        │
│  • Android TV      │  • Roku                │
│  • iOS             │                        │
│  • Apple TV        │                        │
│  • Windows         │                        │
└────────────────────┴────────────────────────┘
```
