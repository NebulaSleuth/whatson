# Whats On — Developer Guide

## Prerequisites

- **Node.js** 20+ (LTS recommended)
- **npm** 9+
- **Android Studio** (for Android TV builds) with Android SDK
- **Xcode** (for iOS/tvOS builds, macOS only)
- **Expo Go** app on your phone (for quick mobile testing)

## Repository Structure

```
whatson/
├── apps/
│   └── mobile/                 # React Native + Expo app (phone + TV)
├── packages/
│   ├── api/                    # Node.js + Express backend API
│   └── shared/                 # Shared TypeScript types and constants
├── docker-compose.yml          # Docker deployment
├── tsconfig.base.json          # Shared TypeScript config
└── package.json                # npm workspaces root
```

---

## Initial Setup

```bash
git clone https://github.com/NebulaSleuth/whatson.git
cd whatson
npm install
```

### Backend Configuration

```bash
cp packages/api/.env.example packages/api/.env
```

Edit `packages/api/.env`:

```env
# Plex — leave PLEX_URL empty for auto-discover via plex.tv
PLEX_URL=
PLEX_TOKEN=your_plex_token

# Sonarr (TV Shows) — Settings > General > API Key
SONARR_URL=http://192.168.1.100:8989
SONARR_API_KEY=your_key

# Radarr (Movies) — Settings > General > API Key
RADARR_URL=http://192.168.1.100:7878
RADARR_API_KEY=your_key

# TMDB (optional — falls back to Sonarr/Radarr lookup if not set)
TMDB_API_KEY=
```

**Finding your Plex token:** In Plex Web, click any item → Get Info → View XML → copy `X-Plex-Token` from the URL.

### Mobile App Configuration

```bash
echo "EXPO_PUBLIC_API_URL=http://YOUR_PC_IP:3001/api" > apps/mobile/.env
```

Replace `YOUR_PC_IP` with your machine's LAN IP (e.g., `192.168.1.154`). This is needed for phones and emulators to reach the backend.

---

## Building

### Shared Types Package

Must be built before the API (the API imports from `@whatson/shared`):

```bash
cd packages/shared
npx tsc
```

Or from the repo root:

```bash
npm run build -w packages/shared
```

### Backend API

**Type-check only (no output):**
```bash
cd packages/api
npx tsc --noEmit
```

**Full build (compiles to `dist/`):**
```bash
npm run build -w packages/api
```

**Build standalone executable:**
```bash
cd packages/api
npm run build:standalone
```

This creates `packages/api/standalone/whatson-api` (or `.exe` on Windows) — a single binary with Node.js and all dependencies bundled. Requires Node.js 20+.

**Build bundle only (skip SEA injection):**
```bash
npm run build:standalone:bundle-only
```

Creates `packages/api/standalone/bundle.cjs` which can be run with `node bundle.cjs`.

**Build platform installer:**
```bash
npm run build:installer
```

Creates platform-specific installer in `packages/api/installers/`. See [Installers](#installers) section.

### Mobile App

The mobile app doesn't have a traditional "build" step for development — Expo/Metro bundles on the fly. For production builds, see [Production Builds](#production-builds).

---

## Running

### Backend API (Development)

```bash
# From repo root
npm run dev:api

# Or directly
cd packages/api
npx tsx watch src/index.ts
```

Starts on port 3001 with hot-reload. The `watch` flag restarts on file changes.

**Verify it's running:**
```
http://localhost:3001/api/health
```

### Mobile App — Expo Go (Phone)

```bash
# From repo root
npm run dev:mobile

# Or directly
cd apps/mobile
npx expo start
```

Scan the QR code with Expo Go on your phone.

**Notes:**
- The phone must be on the same network as your PC
- `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` must point to your PC's IP
- Some features (expo-video, Android intents) don't work in Expo Go — use a dev build for those

### Mobile App — Android Emulator

```bash
cd apps/mobile
npx expo start --android
```

Requires Android Studio with an emulator running. If the emulator can't reach the API, the default URL falls back to `10.0.2.2:3001` (Android emulator's alias for host localhost).

### Mobile App — Android TV Emulator

1. Open Android Studio → Device Manager → Create Device → TV → Android TV (1080p)
2. Start the emulator
3. Set environment variables (PowerShell):
   ```powershell
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
   $env:Path += ";$env:ANDROID_HOME\platform-tools"
   ```
4. Build and install:
   ```bash
   cd apps/mobile
   npx expo run:android
   ```
5. In a separate terminal, start Metro:
   ```bash
   cd apps/mobile
   npx expo start --port 8081
   ```
6. If the app shows a 500 error, forward the port:
   ```bash
   adb reverse tcp:8081 tcp:8081
   adb reverse tcp:3001 tcp:3001
   ```

**Important:** `npx expo run:android` compiles native code (not Expo Go). This is required for Android TV — Expo Go doesn't run on TV devices.

### Backend as a Service

```bash
cd packages/api

# Install as a background service (auto-starts on boot)
npm run service:install

# Check status
npm run service:status

# Stop and remove
npm run service:uninstall
```

Works on Windows (Windows Service), macOS (launchd), and Linux (systemd).

### Docker

```bash
# From repo root
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Requires `packages/api/.env` to be configured before building.

---

## Debugging

### Backend API

**Console logging:** The API logs extensively to stdout:
- `[Plex]` — connection discovery, server selection
- `[Sonarr]` — series/episode fetch results
- `[Radarr]` — movie fetch results
- `[Aggregator]` — data merging, service call failures
- `[Discover]` — TMDB/Sonarr/Radarr search

**Debug endpoint:** Hit `http://localhost:3001/api/debug/sonarr/series` (or any Sonarr/Radarr path) to see raw API responses.

**Health check:** `http://localhost:3001/api/health` shows connection status for all services.

**Config check:** `http://localhost:3001/api/config` shows current configuration (secrets masked).

**Common issues:**

| Problem | Cause | Fix |
|---------|-------|-----|
| `[Sonarr] /series returned 0 series` | JSON returned as string | Already handled by `toArray()` — restart backend |
| `[Aggregator] Service call failed: timeout` | Plex server unreachable | Check `[Plex]` logs for which connection was tried |
| Plex shows "not connected" | Using `config.plex.url` instead of `config.plex.token` | Fixed in code — token is the check for auto-discover |
| Empty results cached | First call fails, empty array cached | Empty results are never cached — restart backend |
| Trailing slash in URLs | `.env` has `http://host:port/` | Config strips trailing slashes automatically |

### Mobile App

**Expo Dev Tools:** Press `j` in the Metro terminal to open the debugger.

**React Native Debugger:** Shake your phone (or `Ctrl+M` on Android emulator) → "Debug with Chrome".

**Network requests:** All API calls go through `apps/mobile/lib/api.ts`. The `fetchApi` function:
- Reads response as text first (prevents JSON parse errors on HTML responses)
- Shows clear error messages when the API is unreachable
- Resolves artwork URLs relative to the configured API base URL

**Common issues:**

| Problem | Cause | Fix |
|---------|-------|-----|
| `Network request failed` | Phone can't reach backend IP | Check `EXPO_PUBLIC_API_URL` in `.env`, ensure same network |
| `JSON parse error: Unexpected character <` | API URL wrong, getting HTML | Check Settings tab, update API URL |
| Grey images on Android TV | expo-image rendering issues | Cards use `transition={0}` on TV, discover cards use RNImage |
| Keyboard submit navigates away (TV) | IME action propagates to tab bar | `TVTextInput` uses `returnKeyType="none"` on TV |
| `AsyncStorage` crash in Expo Go | Native module not available | Uses `expo-secure-store` instead |
| `expo-video` error in Expo Go | Native module not available | Auto-falls back to `expo-av` |

### Android TV Debugging

**ADB commands:**
```bash
# List connected devices
adb devices

# Forward ports from emulator to host
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3001 tcp:3001

# View app logs
adb logcat -s ReactNativeJS

# Send remote button presses
adb shell input keyevent KEYCODE_DPAD_UP
adb shell input keyevent KEYCODE_DPAD_DOWN
adb shell input keyevent KEYCODE_DPAD_LEFT
adb shell input keyevent KEYCODE_DPAD_RIGHT
adb shell input keyevent KEYCODE_DPAD_CENTER    # Select
adb shell input keyevent KEYCODE_BACK
```

**Focus debugging:** If D-pad navigation doesn't work as expected:
- Cards use `nextFocusLeft`/`nextFocusRight` (self-referencing) to trap horizontal focus
- `ShelfList` component wires `nextFocusUp`/`nextFocusDown` between shelves (always targets first card)
- `TVFocusGuideView` is available but not used (unreliable on Android TV)
- All interactive elements need `focusable={true}` on TV

---

## Production Builds

### Android APK/AAB

```bash
cd apps/mobile

# Debug APK
npx expo run:android

# Release APK (requires signing config)
npx expo run:android --variant release

# EAS Build (cloud)
npx eas build --platform android
```

### iOS

```bash
cd apps/mobile

# Simulator
npx expo run:ios

# EAS Build (cloud, requires Apple Developer account)
npx eas build --platform ios
```

### Installers

**Prerequisites by platform:**

| Platform | Tool | Install |
|----------|------|---------|
| Windows | NSIS (optional) | https://nsis.sourceforge.io/ |
| macOS | pkgbuild | Built into macOS |
| Linux | fpm | `gem install fpm` |

**Build process:**
```bash
cd packages/api

# Step 1: Build standalone executable
npm run build:standalone

# Step 2: Create installer
npm run build:installer
```

**Output:**

| Platform | File | Installs as |
|----------|------|-------------|
| Windows | `whatson-api-VERSION-setup.exe` | Windows Service |
| macOS | `whatson-api-VERSION.pkg` | launchd daemon |
| Linux | `whatson-api-VERSION.deb` | systemd service (Debian/Ubuntu) |
| Linux | `whatson-api-VERSION.rpm` | systemd service (RHEL/Fedora) |
| All | `whatson-api-VERSION-PLATFORM-portable.zip` | Manual run |

---

## Type Checking

```bash
# All packages
npm run typecheck

# Individual
cd packages/shared && npx tsc --noEmit
cd packages/api && npx tsc --noEmit
```

---

## Key Architecture Decisions

### Why npm workspaces (not Turborepo/Nx)?
Sufficient for 3 packages, zero config, no extra dependency.

### Why react-native-tvos fork?
The only way to get Android TV + Apple TV support in React Native. Swapped via npm alias in `apps/mobile/package.json`: `"react-native": "npm:react-native-tvos@~0.81.5-2"`.

### Why expo-av over expo-video?
`expo-video` requires native modules not available in Expo Go. The player auto-detects: uses `expo-video` in native builds, falls back to `expo-av` in Expo Go.

### Why artwork proxy?
Plex artwork URLs contain auth tokens and the Plex server may not be reachable from the phone. The backend proxies and caches artwork, serving it to the app through `/api/artwork?url=...`.

### Why TVmaze for tracked shows?
Free, no API key required, provides episode-level schedule data. Used to find recent/upcoming episodes for shows tracked via streaming providers.

### Why Sonarr/Radarr lookup as TMDB fallback?
TMDB requires an API key. Sonarr and Radarr have built-in lookup endpoints that query TMDB/TVDB using their own keys, so users don't need a separate TMDB account.

---

## Environment Variables Reference

### Backend (`packages/api/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | API port (default: 3001) |
| `PLEX_URL` | No | Plex server URL (empty = auto-discover) |
| `PLEX_TOKEN` | Yes | Plex authentication token |
| `SONARR_URL` | No | Sonarr server URL |
| `SONARR_API_KEY` | No | Sonarr API key |
| `RADARR_URL` | No | Radarr server URL |
| `RADARR_API_KEY` | No | Radarr API key |
| `TMDB_API_KEY` | No | TMDB API key (optional, falls back to Sonarr/Radarr) |
| `EPG_PROVIDER` | No | EPG provider: tvmaze (default) |
| `EPG_COUNTRY` | No | Country code for TV schedules (default: US) |
| `DATA_DIR` | No | Directory for tracked items data (default: `./data`) |

### Mobile App (`apps/mobile/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_API_URL` | No | Backend API URL (default: `http://localhost:3001/api`) |

---

## Data Storage

| Data | Location | Persistence |
|------|----------|-------------|
| Tracked TV shows | `packages/api/data/tracked.json` | File-based, survives restarts |
| Watched state | `packages/api/data/watched.json` | File-based, survives restarts |
| API cache | In-memory (node-cache) | Lost on restart (2 min TTL) |
| App settings (API URL) | Device secure store | Persists across app restarts |
| Sonarr/Radarr prefs | Device secure store | Persists across app restarts |
| Artwork cache | In-memory (server) + disk (app) | Server: 24hr TTL, App: disk cache |
