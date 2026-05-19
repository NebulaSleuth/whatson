# Whats On — Roku channel (phase 0 spike)

A SceneGraph / BrightScript channel that talks to the existing
`packages/api` backend. Currently a one-screen spike: fetches `/api/home`
and renders the resulting shelves as a `RowList` of posters. Architecture
and roadmap live in [`PLAN.md`](./PLAN.md).

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

   `scripts/deploy.js` writes both into `source/Config.brs` (a
   gitignored, regenerated-on-every-deploy file) so they ship inside
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

   Resolution order at boot: registry → `Config.brs::configApiUrl()`
   / `configPlexUserId()`. Whichever is non-empty wins.

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

The deploy script lives at `scripts/deploy.js` and zips the four
top-level dirs (`manifest`, `source/`, `components/`, `images/`) before
sideloading.

## Layout

```
manifest                       Roku channel manifest
source/main.brs                channel entry point
components/HomeScene.{xml,brs} root scene + shelves rendering
components/ApiTask.{xml,brs}   reusable async HTTP task
images/                        channel art (placeholders for now)
scripts/deploy.js              `roku-deploy` sideload
scripts/package.js             `roku-deploy` package-only
```

See `PLAN.md` for the full architecture and what each subsequent phase
adds.
