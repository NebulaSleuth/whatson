# Whats On

A multi-platform media aggregation app that shows you what you can watch tonight. Combines content from Plex, Jellyfin, Emby, Sonarr, Radarr, HDHomeRun tuners, and streaming services into a single unified experience.

## Features

- **Continue Watching** — Resume in-progress content from any configured media server (Plex, Jellyfin, Emby)
- **Ready to Watch** — Recently downloaded TV episodes and movies available in your library
- **Coming Soon** — Upcoming episodes from Sonarr calendar and tracked streaming shows (via TVmaze); past-due items stay visible 7 days with a **LATE** badge and a **Search Now** action
- **Download Management** — See download progress/ETA on downloading items; cancel or cancel-and-re-search stuck downloads
- **Discover & Track** — Search for TV shows and add them to your watchlist with a streaming provider, or add directly to Sonarr/Radarr
- **Built-in Player** — Stream with HLS transcoding, quality/bitrate selection, and progress tracking
- **Live TV** — HDHomeRun tuner channels with EPG + ffmpeg HLS proxy, plus a TVmaze "What's on TV" guide
- **Sports** — league-based sports shelves (opt-in per user)
- **User Profiles** — unified "Who's Watching?" users with roles, PINs, avatars, and per-subsystem account mapping
- **Remote Access** — cloud control plane + per-server TLS; clients race LAN vs. remote connections
- **29 Streaming Providers** — Netflix, YouTube TV, Hulu, Disney+, Max, Amazon Prime Video, Apple TV+, Paramount+, Peacock, Sling TV, Fubo TV, and more
- **Mark as Watched** — Scrobble to your media server, track watched state for streaming shows
- **Add to Sonarr/Radarr** — Add shows and movies directly from discover search with quality profile and monitor selection

## Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| Android (phone/tablet) | Working | Expo Go or dev build |
| Android TV | Working | Dev build required (`WHATSON_TV=1 npx expo run:android`) |
| iOS | Working | Expo Go or dev build |
| Apple TV (tvOS) | Working | react-native-tvos build |
| Web | Working | `apps/web` SPA, served at `/` by the backend |
| Roku | Working | `apps/roku` BrightScript channel (sideload; store packaging pending) |
| Windows | Planned | react-native-windows |

## Architecture

```
Phone / TV app (React Native + Expo)   Web app (React SPA)   Roku channel (SceneGraph)
        \                  |                  /
         \                 |  REST API       /
          v                v                v
        Whats On Backend (Node.js + Express)
            |--- Plex / Jellyfin / Emby (media-server adapters)
            |--- Sonarr (TV show management)
            |--- Radarr (Movie management)
            |--- HDHomeRun tuners (Live TV via ffmpeg HLS proxy)
            |--- TVmaze (Episode schedules, TV guide)
            |--- TMDB (Discover search, fallback to Sonarr/Radarr lookup)
            |
            +--- Whats On Cloud (packages/cloud) — remote-access
                 control plane: server registry, device-code auth,
                 invites, ACME DNS-01 for per-server TLS
```

## Quick Start

### Prerequisites

- Node.js 20+
- Plex Media Server with a Plex token
- Sonarr and/or Radarr (optional)
- Expo Go app on your phone (for testing)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/whatson.git
cd whatson
npm install
```

### 2. Configure the backend

```bash
cp packages/api/.env.example packages/api/.env
```

Edit `packages/api/.env` with your server details:

```env
# Plex — leave PLEX_URL empty for auto-discover, or set your server URL
PLEX_URL=
PLEX_TOKEN=your_plex_token

# Sonarr — Settings > General > Security > API Key
SONARR_URL=http://192.168.1.100:8989
SONARR_API_KEY=your_sonarr_api_key

# Radarr — Settings > General > Security > API Key
RADARR_URL=http://192.168.1.100:7878
RADARR_API_KEY=your_radarr_api_key

# Optional: TMDB API key for discover search (falls back to Sonarr/Radarr lookup)
TMDB_API_KEY=
```

**Finding your Plex token:** Plex Web > any item > Get Info > View XML > copy `X-Plex-Token` from the URL.

### 3. Start the backend

```bash
npm run dev:api
```

The API starts on port 3001.

### 4. Start the mobile app

```bash
# Set API URL for your phone to reach the backend
echo "EXPO_PUBLIC_API_URL=http://YOUR_PC_IP:3001/api" > apps/mobile/.env

npm run dev:mobile
```

Scan the QR code with Expo Go on your phone.

### 5. Android TV (optional)

Requires Android Studio with Android SDK installed.

```bash
cd apps/mobile
npx expo run:android
```

## Project Structure

```
whatson/
├── apps/
│   ├── mobile/                 # React Native + Expo app (phone + TV)
│   │   ├── app/                # Expo Router screens
│   │   │   ├── (tabs)/         # Home, TV, Movies, Live TV, Sports, Library, Search, Settings
│   │   │   └── player.tsx      # Built-in video player
│   │   ├── components/         # UI components
│   │   ├── constants/          # Theme (colors, typography, dimensions)
│   │   └── lib/                # API client, storage, TV utilities, connection racer
│   ├── web/                    # React SPA (Vite) — served at / by the backend
│   └── roku/                   # SceneGraph / BrightScript channel
├── packages/
│   ├── api/                    # Backend API server
│   │   ├── src/
│   │   │   ├── routes/         # API endpoints
│   │   │   ├── services/       # Plex/Jellyfin/Emby adapters, Sonarr, Radarr, live TV, sports, users
│   │   │   └── middleware/     # apiAuth, userContext, roles, sessionAuth
│   │   └── .env.example        # Configuration template
│   ├── shared/                 # Shared TypeScript types and constants
│   └── cloud/                  # Remote-access control plane (deployed to Azure)
├── CLAUDE.md                   # Architecture & contributor guide (kept current)
├── HANDOFF.md                  # Current deploy state + resume points
├── research.md                 # API research and framework comparison (historical)
└── plan.md                     # Original implementation plan (historical)
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/home` | Aggregated home screen (all sections) |
| `GET /api/tv/recent` | Ready to watch TV episodes |
| `GET /api/tv/upcoming` | Coming soon TV episodes |
| `GET /api/movies/recent` | Ready to watch movies |
| `GET /api/movies/upcoming` | Coming soon movies |
| `GET /api/search?q=...` | Search library (Plex + Sonarr + Radarr) |
| `GET /api/discover/search?q=...` | Discover search (TMDB or Sonarr/Radarr fallback) |
| `POST /api/scrobble` | Mark as watched |
| `POST /api/tracked` | Add tracked TV show |
| `POST /api/sonarr/add` | Add series to Sonarr |
| `POST /api/radarr/add` | Add movie to Radarr |
| `GET /api/playback/:ratingKey` | Get HLS stream URL for playback |
| `GET /api/health` | Service connection status |
| `GET /api/config` | Server configuration (masked secrets) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile/TV App | React Native, Expo SDK 54, react-native-tvos, Expo Router |
| State Management | TanStack Query, Zustand |
| Backend | Node.js, Express, TypeScript |
| Shared Types | @whatson/shared npm workspace |
| Video Player | expo-video (native builds; playback unavailable in Expo Go) |
| Storage | expo-secure-store (app prefs), file-based JSON (tracked items) |
| Cache | node-cache (in-memory with TTL) |

## Android TV Controls

- **D-pad Left/Right** — Navigate within a shelf row
- **D-pad Up/Down** — Move between shelf rows (always goes to first card)
- **Select/Enter** — Open item detail / press buttons
- **Back** — Close detail sheet / exit player / navigate back
- **Player controls** — Play/Pause, -30s/+30s seek, Quality picker

## License

MIT
