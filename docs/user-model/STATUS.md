# Unified User Model — Status & Resume Point

**Last updated:** 2026-07-05
**Plan of record:** [`00-vision.md`](00-vision.md) (decided model) +
[`01-implementation.md`](01-implementation.md) (build blueprint, phases A–E).
**Deeper history:** MemPalace wing `claude_sessions`/`conversations`, source
`session/2026-07-05`.

---

## TL;DR

We pivoted away from the M7 "guest / viewer / binding" model to a **unified user
model** (users = people; Whats On owns identity; subsystems are content sources).
The vision + implementation plan are **written, decided, committed, pushed**. The
build has **started**: the two net-new Phase-B foundation modules are done and
verified. The next step is the **Phase A data-model refactor** (not started).

---

## ✅ Done (committed + pushed)

- **Vision + plan of record** — `00-vision.md`, `01-implementation.md`
  (`dc255c6`, `93a2ae8`, `47ac0f9`, `69bdc0e`). All decisions settled:
  - **§8 fully-shared:** cloud account = server-access only; the shared "Who's
    Watching?" picker + PIN is the identity layer, identical LAN/remote. Isolation
    is by PIN (accepted tradeoff). Kills M7 open/closed/binding.
  - **§11:** unmapped users allowed as transient state (no content until mapped;
    no "inherit default" mode); watched state = subsystem-native per mapped user.
  - **Model A** chosen: each Whats On user maps to real subsystem identities.
- **Phase B foundations** (`c32ba19`):
  - `services/secrets.ts` — AES-256-GCM at rest (master key: `WHATSON_SECRET_KEY`
    env or generated `data/whatson-secret.key`). **Verified 5/5.**
  - `services/subsystemUsers.ts` — Jellyfin/Emby user management (admin auth →
    create / set-password / library-restrict / delete / map-existing +
    `provisionUser()` returning userId + encrypted token). Typechecks; wraps the
    exact ops proven live 8/8 earlier. **Live module re-test pending** (needs the
    JF/Emby admin password again — see gotchas).

### Live capabilities already verified (against the owner's real servers)
- **Jellyfin 10.11.8** (`http://192.168.1.206:8096`) + **Emby 4.9.5.0**
  (`http://192.168.1.211:8096`), admin user **Mike**: full lifecycle 8/8 —
  create, generated password, per-user `EnabledFolders` library restriction, login
  as new user, delete. → JF/Emby = full auto-provision.
- **Plex** (owner NebulaSleuth, **Plex Pass lifetime**, Home 5/15 → 10 free slots,
  server `M1Silicon`): Home-user mapping/creation only, capped 15, Plex-Pass-gated;
  external shared "friends" are out of scope. → admin-managed.

---

## ⏭️ RESUME HERE — Phase A: data-model refactor (`whatsonUsers.ts`)

The next chunk. **Not started.** It restructures the Whats On user and ripples.

**Shape (target):** `WhatsOnUser` gains `role: 'admin'|'member'`, and the flat
`plexUserId`/`plexUserToken`/`jellyfinUserId`/`embyUserId` become nested
`mappings.{plex,jellyfin,emby}` (each `{ userId/homeUserId, token: EncBlob, managed }`)
+ `libraries.{plex,jellyfin,emby}: string[]`. Remove the `enabled` flag and
`guestMode` (always-on). See `01-implementation.md` §1.1.

**Blast radius:** ~95 references across ~13 files — `middleware/userContext.ts`,
`services/adapters/registry.ts` (`getConfiguredAdapters` scoping), `routes/whatsonUsers.ts`,
and the content routes (`home/tv/movies/library/live/playback/recommendations/scrobble`).
Note: many `.plexUserId` hits are the **legacy `req.plexUserId`** (the Plex-picker
path), which is *not* changing — filter those out.

**Recommended approach:**
1. **Additive-first** — introduce `role`/`mappings`/`libraries` alongside the old
   fields, migrate to populate them, move consumers over, then delete the old
   fields. Keep `typecheck` green at every step (no big-bang).
2. **Migration** (idempotent, non-destructive; back up the JSON first):
   - No `whatsonUsers.json` → force-on + auto-create an `admin` user from the Plex
     owner (+ JF/Emby admin if configured).
   - Existing users → restructure flat fields into `mappings`; first user → `admin`.
   - Encrypt plaintext `plexUserToken` in place via `secrets.encryptSecret`.
3. **Test** migration on synthetic old-format data AND the empty case (the owner's
   live box has **no `whatsonUsers.json`** — see gotchas — so its migration is the
   empty case).
4. Add the **per-user PIN session token** (impl §2.3) so `X-Whatson-User` isn't
   client-trusted — load-bearing under fully-shared.

**Then (rest of A+B):** wire `subsystemUsers.provisionUser` into the create-user
flow; `pairing.ts` drop `guestBinding`/`boundWoProfileId`; `userContext.ts` remove
the binding branches + "inherit default"; admin UI (remove enable toggle +
guest-mode radios; add role + create-user-with-subsystems/libraries).

Then Phases C (per-user libraries UI), D (invites-as-users — rework M7 cloud/backend/
mobile), E (cleanup). See `01-implementation.md` §3 + the §5 unwind checklist.

---

## Gotchas / key facts for a fresh session

- **Live service has no `whatsonUsers.json`.** WO-Users was never set up on the
  owner's box (`C:\Program Files\WhatsOn\data\` has only a `users/` watched-state
  dir). So migration there is the trivial empty case.
- **This machine IS the live backend** (`192.168.1.181:3001` = localhost, NSSM
  service `whatson-api`). Don't double-boot (EADDRINUSE) and don't test-write
  against it. Admin routes answer on the LAN IP but **404 on loopback** (known
  quirk). Most `/api/*` are auth-gated now (admin password set).
- **To re-test `subsystemUsers` live**, you need the JF/Emby admin password again —
  the owner deleted `c:\temp\pw.txt` (correctly). JF `http://192.168.1.206:8096`,
  Emby `http://192.168.1.211:8096`, user `Mike`. Set `JELLYFIN_URL/USERNAME/PASSWORD`
  + `EMBY_*` env and run a probe (see the pattern used this session).
- **`secrets.ts` key** lives at `<DATA_DIR>/whatson-secret.key` (0600). Losing it
  makes existing encrypted tokens undecryptable — back it up alongside the data.
- **JF/Emby config** in the backend is `{ url, username, password }` (admin creds);
  `config.jellyfin` / `config.emby`. Not currently set on the owner's box.
- **M7 is deployed but being superseded.** Cloud is live on Azure with M7 code
  (invites/membership/device-code); backend `v0.1.143` is released but the owner
  hasn't applied it from `/setup` (and may skip it — the guest/invite UI is about
  to be reworked). Per-server TLS, cloud control plane, device-code, and the Azure
  `CLOUD_DATA_DIR` fix all carry forward unchanged.

## Verification commands

```
npm run typecheck -w packages/api        # backend
npm run typecheck -w packages/cloud
npm test -w packages/cloud               # M7 cloud integration (will need rework for ServerMembership)
```
Live probes this session used throwaway `.ts` under `packages/api/src/` run via
`node_modules/.bin/tsx` with env pointed at the real servers, cleaning up test users.
