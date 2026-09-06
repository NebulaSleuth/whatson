# Whats On — Roku channel

A SceneGraph / BrightScript channel that talks to the existing `packages/api`
backend. **Feature-complete through PLAN Phase 3**: Home shelves, TV Shows,
Movies, Live TV, Sports, Library, Search, Settings; detail view with playback,
watch-state, Sonarr/Radarr add + download-queue management (cancel /
re-search / Search Now, LATE badge); Plex **and** unified Whats-On user
accounts with per-device auth-key pairing. Architecture, shipped status,
divergences, and roadmap live in [`PLAN.md`](./PLAN.md) — see its STATUS block
first.

Implementation note: the channel is a single mega-scene
(`components/HomeScene.brs`) plus flat leaf components (PosterItem,
ActionButton, ApiTask, EpisodeListItem, LiveChannelItem, SportsCard,
TabButton, ToggleRow, UserCardItem) — not the multi-scene layout PLAN §4
originally sketched.

## Prerequisites

1. **Roku in developer mode.** From the Roku home screen, press
   `Home Home Home Up Up Right Left Right Left Right`. The device
   reboots into a developer installer at `http://<roku-ip>` with
   username `rokudev` and a password you choose on first launch.

2. **Backend running and reachable** from the Roku's network. Configure
   the channel by setting deploy-time env vars:

   ```bash
   ROKU_HOST=192.168.1.50 \
   ROKU_DEV_PASSWORD=changeme \
   ROKU_API_URL=http://192.168.1.10:3001 \
   ROKU_PLEX_USER_ID=1001793 \
   npm run roku:deploy
   ```

   - `ROKU_API_URL` — backend base URL.
   - `ROKU_PLEX_USER_ID` — *(optional, but you almost always want it)* —
     sent on every API request as `X-Plex-User`. Without it the
     backend resolves the request as anonymous, which usually means
     no Plex content (Jellyfin / Emby still work fine since they're
     single-user adapters). Find your user IDs at
     `GET <apiUrl>/api/users` — the `id` field of each entry.
   - `ROKU_AUTH_KEY` — *(optional — usually leave it unset)* — a
     per-device auth key baked as `configAuthKey()`. The backend allows
     keyless LAN reads and **rejects an invalid key**, so baking a stale
     key breaks the channel while no key works fine. A key obtained from
     a real pairing is stored in the registry and wins over the baked
     value anyway. Only set this if you have a known-current key.

   `scripts/deploy.js` writes these into `source/Config.brs` (a
   gitignored, regenerated-on-every-deploy file) as `configApiUrl()`,
   `configPlexUserId()`, and `configAuthKey()`, so they ship inside
   the channel zip and survive reboots / reinstalls. The Roku
   registry is still consulted as an override — useful for changing
   the URL or user at runtime via telnet without redeploying:

   ```
   telnet <roku-ip> 8085
   ' Ctrl-C to break in, then:
   sec = CreateObject("roRegistrySection", "whatson")
   sec.Write("apiUrl", "http://192.168.1.10:3001")
   sec.Write("plexUserId", "1001793")
   sec.Flush()
   ```

   Resolution order at boot: registry → `Config.brs` values. Whichever
   is non-empty wins.

3. **Node + npm** at the repo root for the deploy script.

## Day-to-day

```bash
# Sideload + restart the channel:
ROKU_HOST=192.168.1.50 ROKU_DEV_PASSWORD=changeme npm run roku:deploy

# Tail the channel's print output and BrightScript debugger:
telnet 192.168.1.50 8085

# Build a standalone .zip for manual install / store submission:
npm run roku:package
```

A `statusCode 200` deploy result means the BrightScript **compiled clean
on-device** (a syntax error returns the file + line) — that's the main
validation, since there's no local BrightScript compiler.

The deploy script lives at `scripts/deploy.js` and zips five entries
(`manifest`, `source/`, `components/`, `images/`, `fonts/`) before
sideloading. **Known issue:** `scripts/package.js` omits `fonts/**/*`, so a
store package would ship without NotoSansSymbols.ttf (the Settings gear
glyph) — fix before store submission (`docs/KNOWN-ISSUES.md`).

## Layout

```
manifest                       Roku channel manifest (title=What's On TV)
source/main.brs                channel entry point
source/Config.brs              generated per-deploy (gitignored)
components/HomeScene.{xml,brs} the entire channel UI (all tabs + detail + player)
components/*.{xml,brs}         leaf components (PosterItem, ApiTask, ActionButton, …)
images/                        channel art
fonts/                         NotoSansSymbols (Settings gear glyph)
scripts/deploy.js              `roku-deploy` sideload
scripts/package.js             `roku-deploy` package-only
```

See `PLAN.md` for the architecture, parity commitments, and recorded
divergences.
