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
- The mobile + Roku working-tree changes are **intentionally uncommitted** (see below) —
  do not discard them; they contain shipped-to-device UI.
- Next work candidates, in rough priority: mobile PIN session token → Roku store
  packaging fix → Phase C library UI (all in `docs/KNOWN-ISSUES.md`).

## Deploy state

| Thing | State |
|---|---|
| Backend release | v0.1.147 (`2fde38d`), GitHub release cut; in-channel updater deploys it |
| Home server | `http://192.168.1.181:3001` — NSSM service `whatson-api`, auto-updates hourly. Was at 0.1.146 when v0.1.147 was released; check `/api/health` + `/api/update/status` |
| Cloud | `@whatson/cloud` deployed to Azure — `cloud.whatsontv.net`; per-server TLS via `<serverId>.s.whatsontv.net` |
| SHIELD (Android TV) | `192.168.1.69:5555` via adb — release APK with v0.1.145/146 UI installed |
| Roku #1 | `192.168.1.129` — sideloaded, current; dev password `abcdefg` |
| Roku #2 | `192.168.1.198` ("75\" onn. Roku TV") — sideloaded **keyless**, current; dev password `abcdefg` |
| Android phone (RT7 TITAN 5G) | release APK installed 2026-07-26 (same build as SHIELD) |

The LAN devices are only reachable when you're on that network — timeouts just mean
you're elsewhere, not that something broke.

## Uncommitted working-tree files (KEEP)

Per the project's commit cadence, backend/shared go to git (the updater deploys from
GitHub releases) but **mobile/Roku client changes stay local** — devices are deployed
directly (adb / sideload). These six files hold the entire client side of the
download-cancel (v0.1.145) and LATE + Search Now (v0.1.146) features:

- `apps/mobile/components/ContentCard.tsx` — LATE/RERUN badges, group-count chip
- `apps/mobile/components/DetailSheet.tsx` — download status panel, Cancel / Cancel &
  Re-search / Search Now buttons
- `apps/mobile/lib/api.ts` — `cancelDownload`, `cancelAndResearch`, `searchNow`
- `apps/roku/components/HomeScene.brs` / `HomeScene.xml` / `PosterItem.brs` — same
  features on Roku

If a device ever needs rebuilding, these must be present. (Committing them is fine if
the cadence ever changes; nothing else depends on them staying uncommitted.)

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
  ECP (`http://<ip>:8060/keypress/...`), tail logs via telnet :8085.

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

1. **Mobile PIN session token** (`docs/user-model/02-remaining.md` #1) — capture
   `sessionToken` from `POST /whatson-users/:id/select`, send `X-Whatson-Session`,
   then flip `WHATSON_STRICT_PIN` on. Backend side is done.
2. **Roku store packaging** — add `fonts/**/*` to `apps/roku/scripts/package.js`,
   then start PLAN Phase 4 (store submission).
3. **Phase C library UI** (`02-remaining.md` #2) — wire `setLibraries` into
   `PATCH /whatson-users/:id` + admin UI edit form.
4. Full open-items list: `docs/KNOWN-ISSUES.md`.
