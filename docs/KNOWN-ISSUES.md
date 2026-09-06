# Known Issues & Incomplete Features

Consolidated list, verified against code **2026-09-06** (backend v0.1.147).
Detail lives in the linked docs; this page is the index. Machine/deploy-state
notes (device fleet, uncommitted files, build-environment quirks) live in
[`../HANDOFF.md`](../HANDOFF.md).

## Known issues (bugs / sharp edges)

1. **Roku store package omits fonts.** `apps/roku/scripts/package.js` zips
   `manifest`, `source/`, `components/`, `images/` but not `fonts/**/*`, while
   `deploy.js` includes it. A store `.zip` would ship without
   NotoSansSymbols.ttf (Settings gear glyph). Fix before store submission.
2. **Stale `ROKU_AUTH_KEY` breaks Roku deploys.** The backend's `apiAuth`
   allows keyless LAN reads but rejects an *invalid* key — baking an old key
   via `ROKU_AUTH_KEY` (e.g. the stale value in the local `setroku.ps1`)
   makes every request fail. Deploy keyless; a real pairing's registry key
   wins over the baked value.
3. **Updater can't be forced headlessly.** `POST /api/update/check` only
   *detects*; auto-apply happens on the updater's scheduled tick (startup+60s,
   then hourly), and running the NSIS `setup.exe /S` from a non-elevated shell
   fails UAC. To apply immediately the owner clicks Apply in `/setup → Updates`.
4. **BrightScript `Val()` corrupts large ids.** 32-bit float — Sonarr/Radarr
   queue ids must be passed as **strings** end-to-end (backend `Number()`-parses).
   Already handled in the shipped code; keep it that way when touching queue code.
5. **Roku LayoutGroup reserves space for invisible children.** Contextual
   action buttons need their own LayoutGroup (`downloadActions`,
   `searchActions` in `HomeScene`) or they render off-screen. Pattern note for
   future Roku work.
6. **Minor:** `apps/roku/components/PosterItem.xml` header comment says
   "160×240" but the node is 220×330 (both 2:3) — comment nit only.

## Incomplete features (by area)

### Unified user model — `docs/user-model/02-remaining.md` (authoritative)
1. **Mobile PIN session token not consumed.** Backend mints `sessionToken` on
   `POST /whatson-users/:id/select`; mobile discards it and never sends
   `X-Whatson-Session`. Keep `WHATSON_STRICT_PIN` off until built.
2. **Phase C library UI.** Admin UI can set Jellyfin/Emby libraries only at
   user creation; editing an existing user's libraries isn't wired
   (`PATCH /whatson-users/:id` never calls `setLibraries`).
3. **Self-create provisioning.** `provisioningRef` is forwarded to the cloud
   but nothing consumes it; invited guests get a bare profile with no
   subsystem accounts.
4. Loose ends: `whatsonUsers.setEnabled` is vestigial.

### Remote access / cloud — `packages/cloud/README.md`
5. Wire types (`GrantPayload`, `CloudEnvelope`, …) not yet promoted to
   `@whatson/shared`.
6. Cloud store is still a JSON file (`cloud-db.json`); Azure Table/Postgres
   swap pending.
7. No rate limiting on `/accounts/login`, `/servers/claim`, `/invites/redeem`,
   device-code poll/approve.
8. v2 bandwidth-capped relay for CGNAT users — designed
   (`docs/remote-access/03-v2-relay.md`), not built.

### Live TV — `LiveTV.md`
9. **Phase 2 not built:** surfacing Plex DVR / Jellyfin / Emby live sources.
   Phase 1 (HDHomeRun tuner + ffmpeg HLS proxy) is shipped.

### Platforms
10. **Roku store submission (PLAN Phase 4)** not started — blocked on issue #1;
    channel is sideload-only.
11. **Windows client** planned, not started (no react-native-windows dep).
12. **Phone-variant Android APK:** the checked-in `apps/mobile/android/` project
    was prebuilt with `WHATSON_TV=1`, so its manifest carries
    `leanback required=true` + TV banner. Sideloads fine on phones (runtime
    `Platform.isTV` picks the phone UI), but a Play-Store phone listing needs a
    re-prebuild without `WHATSON_TV` — which regenerates `app/build.gradle` and
    loses the local release-signing tweak (release buildType uses the debug
    keystore); re-apply it after prebuild.
