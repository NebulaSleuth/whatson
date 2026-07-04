# Remote Access — Implementation Status & Resume Point

**Last updated:** 2026-07-04
**Plan of record:** [`04-implementation-plan.md`](04-implementation-plan.md) (milestones, risk register, effort table)
**Deeper session history:** MemPalace wing `claude_sessions`/`conversations`, source `session/2026-07-04`

---

## TL;DR — where we are

Backend security hardening (doc 01) is **shipped and live on the fleet** through M2.
The cloud control plane (doc 02, M3) is **scaffolded and runs but is uncommitted**.
Client apps (mobile/Roku) are **untouched** so far — client work doesn't start until M5.

| Milestone | Status | Version | Commit |
|-----------|--------|---------|--------|
| M0 — SSRF fix, CORS, bcrypt PINs | ✅ shipped, live | v0.1.130 | `44594b5` |
| M1 — two-listener split + surface hardening | ✅ shipped, live | v0.1.131 | `59d97da` |
| M2 — mandatory auth, roles, profile binding | ✅ shipped, live | v0.1.132 | `948a93a` |
| M3 — cloud control plane | ✅ scaffolded + committed | — | `f790850` |
| M4 — backend registration client | ✅ built + committed (dormant, unshipped) | — | `81b59a0` |
| M5 — client connection manager | 🟡 core done (mobile racer + serverId echo); Roku + re-race listener + offline UX remain | — | `9a1dae6` |
| M6 — remote playback (stream proxy + signed URLs) | ⬜ | — | — |
| M7 — invites + guest roles + device-code | ⬜ | — | — |
| M8 — DNS + certs + UPnP + IPv6 + mDNS | ⬜ | — | — |
| v2 — relay | ⬜ future | — | — |

---

## What shipped (M0–M2, on the fleet)

All fleet-safe: the LAN "open mode" (no admin password) is byte-for-byte the old
behaviour; new enforcement only bites when an admin password is set or on the
(still-dormant) remote listener. **The user's own running service HAS an admin
password set**, so it runs in enforced mode — existing devices migrated to
`owner` and keep full access.

### M0 — v0.1.130
- **`packages/api/src/security/urlGuard.ts`** (new): SSRF guard — `net.BlockList`
  of private/reserved/loopback/link-local ranges with a media-server-host
  exception; `guardedLookup` re-validates at connect time (covers redirects +
  DNS-rebind); `assertFetchAllowed` pre-flight → 400.
- **`routes/artwork.ts`**: exact-origin `api_key` attach (fixed the `startsWith`
  prefix-bypass), `maxRedirects:3`, guarded http/https agents.
- **`security/httpGuards.ts`** (new): CORS allowlist (localhost/.local/private-IP/
  env); `hostGuard` anti-rebind is **opt-in** via `WHATSON_HOST_CHECK=1` (default
  OFF — on-by-default would 403 hostname-based access like Tailscale MagicDNS).
- **`whatsonUsers.ts`**: PINs → bcrypt with transparent SHA-256→bcrypt migration.

### M1 — v0.1.131
- **`packages/api/src/server/surface.ts`** (new, side-effect-free):
  `mountApiRoutes(app, 'lan'|'remote')` + `makeErrorHandler(surface)`. Consumer
  routers on both surfaces; admin routers (`config`, `debug`, `add`, `update`,
  `logs`) LAN-only → 404 on remote by construction.
- **`config.ts`**: `remote { enabled, port }` via `REMOTE_ACCESS` / `REMOTE_PORT`
  (default off / 3002).
- **`index.ts`**: LAN app via `mountApiRoutes`; terminal error handler; a
  **dormant remote listener** that refuses to start without an admin password,
  gets `trust proxy: loopback`, and has **no WebSocket** (finding H4).

### M2 — v0.1.132
- **`apiAuth` → `apiAuth(surface)` factory**: LAN keeps open-when-no-password;
  remote is always enforced. Public-path allowlist is surface-aware (LAN pair
  flow not public on remote — H2). Attaches `req.whatsonDevice` (+ role) and
  `req.isAdminSession`.
- **`pairing.ts`**: `PairedDevice` gains `role:'owner'|'guest'` +
  `boundWoProfileId`; legacy records migrate to `owner`. `completePair` takes
  optional role/profile.
- **`middleware/roles.ts`** (new): `requireOwner(surface)` — admin paths need
  owner device or admin session; passes through in LAN open mode.
- **`userContext.ts`**: guest devices locked to their bound WO profile
  (`X-Whatson-User` mismatch → 403); closes the profile-impersonation hole.
- **`surface.ts`**: `apiAuth` now runs **before** `userContext`; `requireOwner`
  mounted on specific prefixes (`/config`, `/logs`, `/debug`, `/sonarr|radarr/add`,
  `/update/apply`) so it doesn't shadow public `/update/status` or `/plex/*` cast.

---

## M3 — cloud control plane (SCAFFOLDED, UNCOMMITTED)

New workspace **`packages/cloud`** (`@whatson/cloud`), ~1,200 lines. Typechecks
(full monorepo passes), runs end-to-end (a 16-check smoke test passed:
register → claim → WSS hello/heartbeat → candidates → grant). **Not committed.**
Only `package-lock.json` changed besides the new dir.

Files: `config.ts`, `types.ts` (records + wire types), `crypto.ts` (Ed25519),
`store.ts` (JSON-file repo), `grants.ts` (issueGrant), `probe.ts`,
`middleware.ts`, `routes/{accounts,servers,invites,deviceCode}.ts`, `ws.ts`,
`index.ts`, `README.md`.

Review findings baked in: **C1** grants are raw Ed25519 detached (no JWT alg);
**H1/M5** cloud never holds server TLS key, its pubkey is pinned via
`/api/cloud-key` (not TOFU); **H3** grant `jti` for single-use; **P1**
`DeviceGrant.cloudToken` for candidate refresh; **P2** `Server.enabled/revokedAt`.

Run it: `npm run dev -w packages/cloud` (see `packages/cloud/README.md`).

---

## Deferred / not-yet-done (don't forget these)

- **Host-header anti-rebind is opt-in** (`WHATSON_HOST_CHECK`), default off. Plan
  was to make it default-on for the IP-only LAN surface once safe — still opt-in.
- **M2 leftovers** (safe while remote is dormant): per-credential **rate limiting
  / lockout** (Item 9) on `/auth/*`, PIN-verify, device-code; **server-side
  PIN-grant** on profile switch.
- **M3 follow-ups**: promote wire types (`Candidate`, `ServerCandidates`,
  `GrantPayload`, `CloudEnvelope`, `HeartbeatPayload`) from
  `packages/cloud/src/types.ts` into `@whatson/shared`; swap JSON store for Azure
  Table Storage / Postgres; add rate limiting on cloud auth endpoints.

## Open decisions (doc 02 §10 — settle before the dependent milestone)

1. **Cloud DNS zone / `CLOUD_DOMAIN`** — ✅ DECIDED: **`whatson.direct`** (infra;
   per-server hostnames `<id>.s.whatson.direct`, plex.direct-style). Branding on a
   separate domain `whatsontv.net`. TODO: register `whatson.direct` + delegate the
   `s.whatson.direct` zone to a DNS host with an API (Azure DNS recommended) for
   the M8 cert flow. Config default now set to `whatson.direct`.
2. **Account model** — email+password (current) vs federate Plex OAuth.
3. **Invite → profile** — auto-create the WO profile on redeem vs require
   pre-create. (Redeem currently assumes it exists.)

---

## Next steps (in order)

1. **Commit M3** when ready (it's additive; not in the backend installer, so it
   deploys nothing).
2. **Pick `CLOUD_DOMAIN`** (open decision #1) — unblocks M4/M8.
3. ✅ **M4 — backend registration client** — DONE (`81b59a0`, dormant/unshipped).
   `services/cloud/` = identity, registration WSS client (register + hello +
   heartbeat + reconnect), grants (verify vs pinned key), redeemedGrants (jti),
   `POST /auth/redeem-grant`. Verified via a 16-check integration harness against
   the live cloud scaffold. NOT yet shipped as a release (dormant, so no rush) —
   and the cloud is NOT deployed to Azure (still runs locally only).
4. 🟡 **M5 — client connection manager** — CORE DONE (`9a1dae6`): mobile
   `lib/connectionRace.ts` (pure, unit-tested) + `connection.ts` + candidate/
   serverId storage + `/api/health` serverId echo, wired into `_layout` init
   (no-op until candidates exist). REMAINING: debounced re-race on network
   change/foreground; the "can't reach your server" offline state (vs the
   pair-device bounce); and the **Roku** parallel-`ApiTask` racer (L).
   Also unbuilt: fetching `/candidates` from the cloud to populate the list
   (needs the cloud deployed) — that's the onboarding tie-in with M7.
   → unlocks the **browse-remotely demo** (over BYO-TLS or a wildcard cert).
5. **M6 — remote playback**: per-adapter stream+segment proxy (Item 8, new code —
   the `hlsProxy.ts` transmux is NOT reusable) + short-lived HMAC signed URLs
   (Item 5), segment URIs signed **inside the playlist**.
6. **M7** — invites + guest roles + device-code (cloud is scaffolded; needs app
   UIs; device-code + keyboard on TV, no QR).
7. **M8** — DNS + per-server DNS-01 certs (or wildcard shortcut), UPnP/NAT-PMP,
   Windows stable-IPv6 (`netsh` Public/Preferred), mDNS/SSDP LAN fallback,
   `/setup` reachability panel.

---

## Operational facts to remember

- **Shipping a backend release** (fleet auto-updates from GitHub Releases):
  bump version in **BOTH** `packages/api/package.json` and
  `packages/shared/src/constants.ts` (`APP_VERSION`), commit + push to `main`,
  `npm run build:installer`, then `gh release create vX --…-setup.exe …zip`.
  The updater polls `NebulaSleuth/whatson` releases and installs `*setup.exe`.
- **Client apps do NOT change** through M4; no AAB/App-Store/Roku rebuild needed
  until M5. M0–M3 are backend-only (+ the new cloud package).
- **User's running service:** `http://192.168.1.181:3001`, Windows NSSM service,
  admin password set (enforced mode). Fleet is current (auto-updated to 0.1.132).
- **Known quirk (user-irrelevant, unresolved):** the running service answers
  admin routes normally via its LAN IP but 404s them via loopback — stale runtime
  state from an update + an accidental `kill-port` bounce during testing. Clients
  are unaffected (they use the LAN IP). An elevated `nssm restart whatson-api`
  (or reboot) clears it. **Never `kill-port 3001`** — it hits the live service.
- Verification approach used throughout: standalone harness that mounts the real
  middleware/routes on a test port and asserts behaviour (open vs enforced).

---

## Side-track (not WhatsOn) — DevSecretStash Azure move — ✅ COMPLETE (2026-07-04)

Moved the **DevSecretStash** App Service from the transferred **MFE** subscription
(`myfriendlyeyes.com` tenant) into the **Extrastrength** subscription
(`extrastrength.com` tenant, billed via the 5335-card account). Cross-tenant
resource move is unsupported, so it was recreated.

Done and verified:
- New app **`devsecretstash-es`** (B1 Linux, DOTNETCORE|9.0) in Extrastrength RG
  `devsecretstash-rg`. Code built from `NebulaSleuth/DevSecretStash` (master,
  `src/DevSecretStash.Api`) and zip-deployed.
- All 7 app settings carried over (incl. `Jwt__Key`/`Jwt__Issuer`).
- SQLite data restored to `/home/site/data/devsecretstash.db` — verified on
  server: 2 users, 2 secret collections, 13 refresh tokens.
- Custom domain `devsecretstash.com` bound + **free managed TLS cert** (GeoTrust,
  valid to 2027-01-04); httpsOnly + HTTP→HTTPS + HSTS. Verified secure in browser.
- DNS at **GoDaddy**: A `@` → `20.118.48.17`, TXT `asuid` → app verification id.
- **Old `devsecretstash-rg` in MFE deleted** (app + plan + cert gone).
- Safety backups retained: `C:\Users\MichaelHartman\Downloads\devsecretstash-backup-20260704-114004.db`
  and `...-FINAL-before-delete-20260704-123717.db` (both 36,864 bytes, integrity ok).

**Remaining (billing, original goal):** set the **Extrastrength billing profile's
default payment method to the 5335 card** (Cost Management + Billing → profile
`QBMR-3ICF-BG7-PGB` → Payment methods). Now that MFE has left that account,
changing the default only affects Extrastrength (which now hosts DevSecretStash).
