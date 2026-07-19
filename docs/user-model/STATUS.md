# Unified User Model — Status & Resume Point

**Last updated:** 2026-07-05 · **Status: SHIPPED (v0.1.144) + verified live**
**Plan of record:** [`00-vision.md`](00-vision.md) (decided model) +
[`01-implementation.md`](01-implementation.md) (build blueprint) +
[`02-remaining.md`](02-remaining.md) (detailed backlog of what's left).
**Deeper history:** MemPalace wing `claude_sessions`/`conversations`, source
`session/2026-07-05`.

---

## TL;DR

The **unified user model** is built, tested, and **deployed to the whole fleet as
v0.1.144** — cloud, backend, Roku, and the SHIELD. Verified live: the owner applied
the update and confirmed the auto-created **NebulaSleuth admin, mapped to his Plex
owner**, in `/setup → Users`, so the always-on migration + auto-admin worked.

The model replaces the M7 "guest / viewer / binding" apparatus (now fully retired):
**users are people** (always-on, no toggle), each mapped to real subsystem
identities with **encrypted tokens**; Whats On can **create Jellyfin/Emby accounts**
with per-user libraries; **PIN session tokens** gate protected users; and **invites
just grant server access** — identity is the shared "Who's Watching?" picker.

---

## What shipped (all committed, pushed, deployed)

**Vision + plan** (`dc255c6`,`93a2ae8`,`47ac0f9`,`69bdc0e`) — decisions in
`00-vision.md`: §8 fully-shared (cloud account = server access; shared picker + PIN
= identity); §11 unmapped→no content + subsystem-native watched state; Model A.

**Phase B foundations** (`c32ba19`)
- `services/secrets.ts` — AES-256-GCM at rest, master key `WHATSON_SECRET_KEY` env
  or generated `<DATA_DIR>/whatson-secret.key`. 5/5.
- `services/subsystemUsers.ts` — Jellyfin/Emby management (create / set-password /
  library-restrict / delete / map-existing + `provisionUser`). Ops proven live 8/8.

**Phase A** — the backend user model
- `6ed8ba5` data-shape refactor: `WhatsOnUser` → nested `mappings.{plex,jellyfin,
  emby}` (`{userId, token:encrypted, managed}`) + `role` + `libraries[]`; typed
  accessors; idempotent migration. 14/14.
- `46b6d41` always-on + `userBootstrap.ensureDefaultAdmin()` (auto-creates the
  Plex-owner admin at startup). `isEnabled()` = users>0. 9/9 vs real Plex.
- `5f66b6a` `provisionUser` wired into create (real JF/Emby users + libraries);
  delete cleans up managed users. 6/6.
- `f93ac12` PIN session token (`/select` mints AES-GCM token; `userContext` checks
  `X-Whatson-Session`; soft default / `WHATSON_STRICT_PIN` hard). 9/9 both modes.
- `0efdcae` admin UI: role select + JF/Emby create-new-user with a library picker;
  `GET /whatson-users/libraries/:kind`; removed the enable toggle.

**Phase D** — invites-as-users + full M7 unwind
- `8c28efb` D1 cloud: invites = `ServerMembership` (no binding); binding-free
  grants; retired InviteBinding + membership/profile. Integration test **21/21**.
- `c9b5116` D2 backend: `GrantPayload`/`PairedDevice` binding fields gone;
  `userContext` binding branch + inherit-default removed. 5/5.
- `2eda7b7` D3 backend: `/remote/invite` = email only; `guestMode` fully retired
  (service + config route + admin "Invite someone" card).
- `c93c60c` D4 mobile: `cloudAuth` returns boolean; `cloud-signin` → shared picker;
  `create-profile` generic; "+ New" self-create in the picker.

**Deployed** (`3d19b6c` = v0.1.144 bump)
- **Cloud** → Azure `whatson-cloud` (`cloud.whatsontv.net`), key preserved.
- **Backend** → GitHub release `v0.1.144`; owner applied it (running 0.1.144).
- **Roku** → re-sideloaded to 192.168.1.129.
- **SHIELD** (`192.168.1.69:5555`) → rebuilt TV APK installed. **Pixel NOT updated.**

### Capabilities verified against the owner's real servers
- **Jellyfin 10.11.8** (`192.168.1.206:8096`) + **Emby 4.9.5.0** (`192.168.1.211:8096`),
  admin **Mike**: full lifecycle 8/8 (create, generated password, `EnabledFolders`
  restriction, login-as-new-user, delete).
- **Plex** (owner NebulaSleuth, Plex Pass lifetime, Home 5/15, server `M1Silicon`):
  Home-user mapping/creation only — capped 15, Plex-Pass-gated; external "friends"
  out of scope.

---

## ⏭️ RESUME HERE — remaining follow-ups (none blocking; model is live)

**Full detail with file-level steps: [`02-remaining.md`](02-remaining.md).** Summary:

1. **Mobile PIN hardening.** The apps don't yet capture the `sessionToken` from
   `POST /whatson-users/:id/select` or send `X-Whatson-Session`, so keep
   `WHATSON_STRICT_PIN` **off** (PIN gate is soft/log-only). Wire the token in
   `apps/mobile` (store it after select; send the header in `lib/api.ts`), rebuild,
   then set `WHATSON_STRICT_PIN=1` on the backend to enforce.
2. **Phase C — per-user library UI polish.** Editing an existing user's libraries
   (today the picker only applies on create-new); a defaults editor. Enforcement
   for mapped-existing users is a policy decision (don't clobber their server-side
   policy silently).
3. **Self-create provisioning spec.** Flow B (invitee self-creates): the invite
   carries `provisioningRef`; wire a backend `data/pending-invites.json` spec
   (libraries + subsystems) that `POST /whatson-users/guest-profile` applies so a
   self-created user is provisioned + library-scoped instead of bare. See
   `01-implementation.md` §1.4 / §6.
4. **Browser E2E of the admin create-user flow** — load `/setup → Users` in a
   browser against the live backend and create a Jellyfin/Emby user for real
   (needs the JF/Emby admin password — see gotchas).
5. **Pixel** — rebuild + install the phone APK when wanted (only the SHIELD was done).

---

## Gotchas / key facts for a fresh session

- **The model is LIVE on the fleet (v0.1.144).** The owner's backend runs it; the
  NebulaSleuth admin (mapped to the Plex owner) was auto-created and confirmed.
- **This machine IS the live backend** (`192.168.1.181:3001` = localhost, NSSM
  `whatson-api`, running 0.1.144). Don't double-boot (EADDRINUSE — it loads the real
  `.env`) and don't test-write against it. Admin routes 404 on **loopback** but work
  on the LAN IP; most `/api/*` are auth-gated (admin password set).
- **JF/Emby are NOT configured in the backend** (`config.jellyfin`/`config.emby`
  empty) — so subsystem *provisioning* is dormant on the live box until the owner
  sets `JELLYFIN_URL/USERNAME/PASSWORD` + `EMBY_*`. To test `subsystemUsers` live you
  need the JF/Emby admin password again (owner deleted `c:\temp\pw.txt`, correctly).
  JF `192.168.1.206:8096`, Emby `192.168.1.211:8096`, user `Mike`.
- **`secrets.ts` master key** lives at `<DATA_DIR>/whatson-secret.key` (0600).
  Losing it makes existing encrypted tokens undecryptable — back it up with the data.
- **Deploy recipe that works** (both fought back once): cloud = build + stage +
  `npm install --omit=dev` + **python forward-slash zip** (`scratchpad/mkzip.py`;
  PowerShell `Compress-Archive` writes backslashes Linux can't extract) + `az webapp
  deploy --type zip`; cloud `CLOUD_DATA_DIR=/home/data` (fixed — was a Git-Bash
  path-mangled value; data lives outside wwwroot so deploys don't wipe the signing
  key/store). Backend = bump BOTH `packages/api/package.json` + `packages/shared/src/
  constants.ts`, `npm run build -w packages/shared`, `npm run build:installer`, `gh
  release create v0.1.NN …`. Updater is owner-apply from `/setup` (auto-poll here is
  unreliable — force with public `POST /api/update/check`).
- **tsx test harness:** throwaway `.ts` under `packages/api/src/` (NOT `.mts` —
  ESM/CJS interop mismatch), async IIFE (CJS, no top-level await), `DATA_DIR` temp,
  env pointed at real servers, clean up test users. `shared` changes need
  `npm run build -w packages/shared` before the api typechecks (api imports the dist).
- **Cloud test** (`npm test -w packages/cloud`) spawns on port 4987 — kill orphans
  first if it fails with a libuv `UV_HANDLE_CLOSING` assertion.

## Verification commands

```
npm run typecheck -w packages/api
npm run typecheck -w packages/cloud
( cd apps/mobile && npx tsc --noEmit )
npm test -w packages/cloud               # 21/21 unified invite flow
```
