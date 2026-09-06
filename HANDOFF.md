# HANDOFF — Whats On

Session-to-session handoff for picking this repo up in Claude (app, Code CLI, or web).
Written 2026-09-06. For architecture read `CLAUDE.md`; for open work read
`docs/KNOWN-ISSUES.md`. This file holds the *state* that isn't derivable from the code:
what's deployed where, what's intentionally uncommitted, and machine-specific gotchas.

## TL;DR

- Backend **v0.1.147** (download monitor — auto-removes malicious / unimportable Sonarr &
  Radarr downloads, opt-in) is committed, pushed, and released on GitHub. The home
  server's updater saw it (`updateAvailable: true`); it auto-applies on the hourly tick
  or when the owner clicks Apply in `/setup → Updates`. **After it lands:** enable the
  monitor in `/setup → Download Monitor` with Dry run on first, then turn dry run off.
  Six `.exe` fakes were sitting in the Sonarr queue when this shipped — the dry run
  flagged all six. No other feature work is in flight.
- **Parity pass (2026-09-06, Mac Mini session):** all three TV clients were brought to
  feature parity in code — see "Parity pass" below. Mobile side is typechecked + tested
  and **installed on the Apple TV**; the Roku side is **compile-unverified** (no Roku
  reachable from the Mac) and must be sideloaded from BigROG to compile. SHIELD needs a
  rebuild from BigROG too. Commit + push this working tree before switching machines.
- Next work candidates: on-device verification of the parity pass → Roku store
  packaging fix → Phase C library UI (all in `docs/KNOWN-ISSUES.md`).

## Deploy state

| Thing | State |
|---|---|
| Backend release | v0.1.147 (`2fde38d`), GitHub release cut; in-channel updater deploys it |
| Home server | `http://192.168.1.181:3001` — NSSM service `whatson-api`, auto-updates hourly. Was at 0.1.146 when v0.1.147 was released; check `/api/health` + `/api/update/status` |
| Cloud | `@whatson/cloud` deployed to Azure — `cloud.whatsontv.net`; per-server TLS via `<serverId>.s.whatsontv.net` |
| Apple TV "Bedroom" | `192.168.1.210` (paired to the Mac Mini via Xcode; tvOS 26.6) — `com.extrastrength.whatsontv` Release build installed 2026-09-06 with the parity pass. The older `com.extrastrength.whatson` install is still on the device — delete it by hand. **Pairing not yet confirmed working** (code box stayed empty on first attempt; server reachability from the TV unverified) |
| SHIELD (Android TV) | `192.168.1.69:5555` via adb — release APK with v0.1.145/146 UI installed; **needs rebuild** for the parity pass (swipe/menu fixes are tvOS-only, but connection toggle, session token, Live TV tuning overlay apply) |
| Roku #1 | `192.168.1.129` — sideloaded with v0.1.146-era UI; **needs re-sideload** (was unreachable/powered off on 2026-09-06 when #2 was done). Same build as #2 — no compile surprises expected; dev password `abcdefg` |
| Roku #2 | `192.168.1.198` ("75\" onn. Roku TV") — **current**: sideloaded keyless 2026-09-06 with the parity pass + subtitle-on-pause fix + focus-warning cleanup. Compiled clean (200), boots to the user picker with a clean debug console. On-device *interaction* pass (parity features, pause > 20s subtitle check) still to do; dev password `abcdefg` |
| Android phone (RT7 TITAN 5G) | release APK installed 2026-07-26 (same build as SHIELD) |

The LAN devices are only reachable when you're on that network — timeouts just mean
you're elsewhere, not that something broke. **Mac Mini gotcha:** the Claude desktop app's
shell has no macOS Local Network permission, so `curl`/`nc` to any LAN host except the
router fails with "No route to host" even when the host is up. Xcode's `devicectl` still
works (system daemon). Don't diagnose server outages from that shell.

## Parity pass (2026-09-06) — what changed, what to verify on-device

Mobile (`apps/mobile`, Apple TV + Android TV; `npm run typecheck`/`test` clean):
- Player: Siri Remote trackpad `swipeLeft/Right/Up/Down` now seek / reveal controls like
  the D-pad (honours the "D-pad only" pref). Menu button routed to `BackHandler` via
  `TVEventControl.enableTVMenuKey()` at boot — previously Menu backgrounded the app from
  every screen. Trade-off: on a root screen with no handler Menu now does nothing.
- Settings → Connection: Local (LAN) / Remote (plex.tv) toggle, persisted; when set it
  suppresses the boot-time Plex local/remote auto-probe.
- PIN session token: `sessionToken` from `POST /whatson-users/:id/select` is stored and
  sent as `X-Whatson-Session`; cleared on Switch User / Re-pair / Forget key. Backend
  `WHATSON_STRICT_PIN` can be flipped on once both mobile and Roku are confirmed sending it.
- Live TV: "Tuning…" overlay until `readyToPlay`, 12 s ceiling → error overlay with
  Retry / Back (copy matches Roku).

Roku (`apps/roku`, **uncompiled** — see PLAN.md STATUS for the on-device checklist):
- "Sign in with Whats On" cloud device-code onboarding + connection-candidate cache/probe.
- Guest self-serve profile creation ("New" tile on the picker; 403s on an owner device by design).
- Settings → Sports: league + team follow picker; Sports tab hidden until a league is followed.
- Sonarr/Radarr add picker: monitor mode + searchForMissing + last-used memory.
- `X-Whatson-Session` header (ApiTask `sessionToken` field).

How to deploy from BigROG: `git pull`, then Roku `node scripts/deploy.js` per "How to ship"
(fix any compile errors the sideload reports), SHIELD `gradlew assembleRelease` + `adb install -r`.

## Working tree

**Everything is committed** as of 2026-09-06 (`ad8eafd`). The Roku (`7b3970f`) and
mobile (`ad8eafd`) client sides of the v0.1.145/146 features, which had been kept
local under the old "client changes stay local" cadence, are now in git. Client code
is still deployed to devices directly (adb / sideload) rather than via releases, but
it is committed like everything else.

Untracked root files (`AppIcons*/`, `*.png`, `icon.ico`, `logo.psd`, `setroku*.ps1`)
are icon-design scratch + local deploy helpers. Note `setroku.ps1` contains a **stale
`ROKU_AUTH_KEY`** — deploy Rokus keyless instead (see `docs/KNOWN-ISSUES.md` #2).

## How to ship

- **Backend release**: follow "Shipping a backend release" in `CLAUDE.md` exactly —
  bump version in BOTH `packages/api/package.json` and
  `packages/shared/src/constants.ts` (plus `npm run build -w packages/shared`), commit,
  push, `npm run build:installer`, `gh release create`. The GitHub release IS the
  deploy. Auto-apply happens on the updater's hourly tick; the owner can force it in
  `/setup → Updates`. You cannot force it headlessly (UAC).
- **SHIELD / phone APK**: build from the existing `apps/mobile/android/` project —
  `gradlew assembleRelease` with `ANDROID_HOME` set. **Do NOT run `expo prebuild`**
  (regenerates `app/build.gradle` and loses the debug-keystore release-signing tweak).
  Output: `app/build/outputs/apk/release/app-release.apk`; `adb install -r` upgrades in
  place. The app's own versionName (0.1.0) is independent of the backend version.
- **Roku**: `node scripts/deploy.js` from `apps/roku` with `ROKU_HOST`,
  `ROKU_DEV_PASSWORD`, `ROKU_API_URL`, `ROKU_PLEX_USER_ID` (no auth key). A
  `statusCode 200` result means it compiled clean on-device. Drive it for testing via
  ECP (`http://<ip>:8060/keypress/...`), tail logs via telnet :8085. `npm run package`
  builds the same zip without deploying (Config.brs baked from the same env).
  **A sideload (and ECP `/launch/dev`) restarts the channel — check the telnet console
  for `onKeyEvent` / `video state -> playing` lines first; the 75" onn. TV is a family
  TV and someone was watching during a 2026-09-06 redeploy.** Custom Group components
  (TabButton, ToggleRow) have no `nextFocus*` fields — all D-pad routing is manual in
  `onKeyEvent`; setting those fields only logs "nonexistent field" (cleaned up 2026-09-06).

## Machine-specific gotchas (Mike's Windows box "BigROG")

- **Gradle/JDK loopback failure**: any Gradle build (and any Java NIO
  `Pipe`/`Selector` user) fails with "Unable to establish loopback connection".
  Root cause: JDK 17 backs NIO pipes with AF_UNIX sockets in `%TEMP%`, and socket-file
  creation silently fails there (cause unknown — no third-party AV, CFA off; TCP
  loopback and AF_UNIX elsewhere are fine). **Workaround (required for Android
  builds)**: `set JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\gtmp` (dir exists).
  `GRADLE_OPTS` alone is not enough — the daemon JVM needs it too, which is what
  `JAVA_TOOL_OPTIONS` covers.
- Backend runtime state is inspectable without the user: `GET /api/health`,
  `/api/update/status`, `/api/logs?lines=&filter=`, `/api/config/status` on
  `192.168.1.181:3001` (keyless LAN reads are allowed).
- MemPalace (`https://umeko-api.azurewebsites.net`) holds cross-session history — wing
  `claude_sessions`, room `conversations`. Search it when context seems missing.

## Where to resume

0. **Sideload the Roku subtitle fix** (`7b3970f`) to both Rokus — `node scripts/deploy.js`
   from `apps/roku`, keyless. Bug: subtitles were lost on any pause > 20s because the
   post-pause session refresh re-requested subtitle 0 (off), which the backend persists
   to Plex. Fix is committed, **not yet on a device**; compile is verified only at
   sideload. Users whose Plex default subtitle got cleared must re-pick it once.
   Mobile is unaffected.
1. **Mobile PIN session token** (`docs/user-model/02-remaining.md` #1) — capture
   `sessionToken` from `POST /whatson-users/:id/select`, send `X-Whatson-Session`,
   then flip `WHATSON_STRICT_PIN` on. Backend side is done.
2. **Roku store packaging** — add `fonts/**/*` to `apps/roku/scripts/package.js`,
   then start PLAN Phase 4 (store submission).
3. **Phase C library UI** (`02-remaining.md` #2) — wire `setLibraries` into
   `PATCH /whatson-users/:id` + admin UI edit form.
4. Full open-items list: `docs/KNOWN-ISSUES.md`.
