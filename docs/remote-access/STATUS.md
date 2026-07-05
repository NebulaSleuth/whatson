# Remote Access — Implementation Status & Resume Point

**Last updated:** 2026-07-05
**Plan of record:** [`04-implementation-plan.md`](04-implementation-plan.md) (milestones, risk register, effort table)
**Deeper session history:** MemPalace wing `claude_sessions`/`conversations`, sources `session/2026-07-04` + `session/2026-07-05`

---

## TL;DR — REMOTE ACCESS WORKS END-TO-END (prod-verified on real phone/cellular)

As of 2026-07-05 the whole "watch from anywhere" system works and is shipped:
- **Playback anywhere** — Plex (its relay), Jellyfin/Emby (M6 stream proxy), live TV
  (backend-served HTTPS) — all verified on the owner's phone over cellular.
- **Per-server production TLS** — `<id>.s.whatsontv.net:3002`, Let's Encrypt via ACME
  DNS-01, cloud-published A/AAAA, valid cert everywhere.
- **Owner self-access** — LAN-paired devices race LAN↔WAN candidates automatically.
- **Cloud web UI + marketing** — live at **https://whatsontv.net** (apex; GoDaddy Website
  Builder disconnected). Account signup/login, `/account` (link a server), `/link` (approve
  a device), two-box code entry.
- **Onboard a NEVER-on-LAN device** — "Sign in with Whats On" device-code flow in the app
  + one-click "Link to my account" in `/setup`. **Verified working.**
- Backend releases **v0.1.130 → v0.1.141** shipped + auto-installed (dormant unless remote
  access enabled). Cloud on Azure App Service. Mailgun email configured.

### ⏭️ RESUME TOMORROW — one piece left: **M7 invite flow (guests)**
Invite a guest by email → they make their OWN account → pick a profile (a Whats On User +
avatar, or a Plex user) → their devices onboard via the same device-code flow, bound as a
`guest`. To build:
1. **Cloud `/invite/:token` page** (`public/invite.html`) — accept invite, sign up (email
   prefilled), `POST /invites/redeem`, pick profile.
2. **`/setup` "Invite a viewer"** — admin enters email → cloud creates invite + Mailgun
   sends the link. (`POST /invites` exists; needs email-send wiring + admin UI.)
3. **Profile binding** — grant carries `role:'guest'` + `boundWoProfileId`; backend
   `provisionDevice` already honors it. Settle open decision #3 (auto-create WO profile
   vs pre-create) at redeem.
Cloud invite/account endpoints are scaffolded; Mailgun (mxa/mxb.mailgun.org + SPF/DKIM/
DMARC) ready. Throwaway `webui-test@whatsontv.net` account is in the cloud store (harmless).

---

## Historical context (M0–M2 detail below still accurate)

Backend security hardening (doc 01) is **shipped and live on the fleet** through M2.
The cloud control plane (doc 02, M3) is **deployed to Azure**.
Client apps: mobile has the connection racer + device-code onboarding; Roku untouched.

| Milestone | Status | Version | Commit |
|-----------|--------|---------|--------|
| M0 — SSRF fix, CORS, bcrypt PINs | ✅ shipped, live | v0.1.130 | `44594b5` |
| M1 — two-listener split + surface hardening | ✅ shipped, live | v0.1.131 | `59d97da` |
| M2 — mandatory auth, roles, profile binding | ✅ shipped, live | v0.1.132 | `948a93a` |
| M3 — cloud control plane | ✅ scaffolded + committed + **DEPLOYED to Azure** | — | `f790850` |
| M4 — backend registration client | ✅ built + **shipped v0.1.133** (dormant) | v0.1.133 | `81b59a0`, `1602be4` |
| M5 — client connection manager | 🟡 core done + race tests + foreground re-race; Roku racer + offline UX + cloud /candidates fetch (domain-gated) remain | — | `9a1dae6`, `49445fe` |
| /setup Remote Access panel | ✅ built + **shipped v0.1.134** (one-click enable + claim code; dormant) | v0.1.134 | `7ef94bd` |
| M6 — remote playback | ✅ **DONE + PROD-VERIFIED on phone/cellular** (Jellyfin/Emby HLS proxy incl. player HLS-detection fix; Plex relay; live TV backend-served HTTPS) | v0.1.140 | `streamProxy` |
| M7 — remote onboarding | 🟢 owner self-access + cloud web UI + **one-click server linking (v0.1.141) + Sign-in-with-Whats-On device-code onboarding (mobile)** DONE; remaining: invite flow for guests | v0.1.141 + cloud + mobile | M7 |
| M8 — secure data path | 🟢 **8a DNS + 8b TLS + 8c WAN-candidate emission DONE & PROD-VERIFIED** (`https://<id>.s.whatsontv.net:3002` externally reachable w/ trusted cert; cloud emits `[lan,ipv6,wan]`); remaining polish: UPnP/pinhole auto (user forwards manually today), stable-IPv6, reachability panel | v0.1.135/136 | `dfd8875`,`eea8cff`,`c944430`,`5e8b526` |
| relay (CGNAT + v4-only client fallback) | ⬜ deferred — future **paid** feature, costly egress | — | — |

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

1. **Cloud DNS zone / `CLOUD_DOMAIN`** — ✅ DECIDED: **`whatsontv.net`** (one
   domain for branding + infra; per-server hostnames `<id>.s.whatsontv.net`,
   plex.direct-style; marketing site on apex/`www`, machinery on `s.`). Dropped
   the separate `.direct`: Azure App Service Domains can't sell that TLD, `.net`
   is supported, and `whatsontv.net` is available. Config default + deployed-cloud
   `CLOUD_DOMAIN` app setting both now `whatsontv.net`. TODO (user): register
   `whatsontv.net` (buyable directly in Azure), host the zone in Azure DNS, manage
   `s.whatsontv.net` records for the M8 DNS-01 cert flow.
2. **Account model** — ✅ DECIDED: **each viewer gets their OWN email+password
   cloud account** (not one account with sub-profiles), created via an emailed
   invite. Plex-OAuth federation stays a possible later add-on.
3. **Invite → profile** — auto-create the WO profile on redeem vs require
   pre-create. (Redeem currently assumes it exists.) M7 flow: the viewer picks a
   WO User + avatar (WO-Users mode) or a Plex Home user at redeem time.
4. **Remote data path / relay** — ✅ DECIDED: **direct paths only this phase, no
   relay.** IPv4 port-forward (primary, works for every client on non-CGNAT
   servers) + IPv6 (for CGNAT / where available), both over **per-server TLS**
   (A/AAAA record + DNS-01 cert). **Plaintext video is off the table** — media
   stays behind TLS + signed capability URLs (decision drivers: credential leak
   on the wire, browser mixed-content block, iOS ATS / Android cleartext).
   **Relay is deferred** — it's the only thing that covers CGNAT-server +
   v4-only-client, but egress is costly; revisit as a **paid-account** feature in
   a later phase, not now. Admin "no port forwarding required" copy is now wrong
   and is being corrected.

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
   `lib/connectionRace.ts` (pure) + `connection.ts` + candidate/serverId storage
   + `/api/health` serverId echo, wired into `_layout` init (no-op until
   candidates exist). ADDED since: persisted race tests (`49445fe`,
   `apps/mobile/lib/connectionRace.test.ts`, `npm test` via tsx — 9 cases incl.
   the P0 wrong-server rejection) and a **debounced foreground re-race**
   (`_layout` AppState 'active' → `resolveConnection()`, invalidates queries if
   the winner changed; dormant-safe no-op without candidates). REMAINING:
   the "can't reach your server" offline state (vs the pair-device bounce — note
   the correctness catch: a naive early-return skips post-connection routing, so
   the retry path must re-run init, not just navigate to '/'); and the **Roku**
   parallel-`ApiTask` racer (L). Also unbuilt and **domain-gated**: fetching
   `/candidates` from the cloud to populate the list — the cloud endpoint
   `GET /servers/:id/candidates` exists and is deployed, but candidates return
   `<serverId>.s.whatsontv.net` hostnames that don't resolve until
   `whatsontv.net` is registered + `s.` delegated, so building the onboarding UI
   against it can't be exercised end-to-end yet. That's the onboarding tie-in
   with M7. → unlocks the **browse-remotely demo** (over BYO-TLS or wildcard cert).
5. **M6 — remote playback**: per-adapter stream+segment proxy (Item 8, new code —
   the `hlsProxy.ts` transmux is NOT reusable) + short-lived HMAC signed URLs
   (Item 5), segment URIs signed **inside the playlist**. **Media stays behind
   TLS + signed capability URLs — plaintext HTTP video is OFF THE TABLE** (it
   would leak a reusable credential on the wire, breaks browser mixed-content,
   and fights iOS ATS / Android cleartext). Signed URLs mean no reusable secret
   ever rides a media request; TLS (M8 per-server cert) makes every platform
   accept the stream.
   **✅ M7-1 — owner self-access DONE (v0.1.137).** The simplest path to remote
   viewing for the owner's OWN devices: they already hold auth keys that work on
   the remote listener, so no cloud account is needed. Backend `GET /api/candidates`
   (consumer surface) returns LAN URLs + the WAN hostname
   (`https://<id>.s.whatsontv.net:<port>`, when remote on + cert held); the app
   caches them on init (on the LAN) via `updateCandidates()` and the built
   foreground racer picks whichever answers (LAN home, WAN away). Fixed a latent
   M5 bug: `pinCandidate` now appends `/api` (candidate URLs are base; the app's
   apiUrl includes `/api`). Needs: backend on 0.1.137 + a fresh mobile build.
   Verification limited by auth-gating (can't curl `/candidates` without a key).

6. **M7 (full)** — invites + self-service accounts + device-code (cloud invites/accounts
   scaffolded; needs the `whatsontv.net` web UI + app "sign in to cloud" screens).
   **Refined flow (decided):** admin invites a viewer by email → viewer clicks
   link → creates their OWN cloud account (email + password) → picks their in-app
   identity (a Whats On User + avatar if the server runs WO-Users mode, else a
   Plex Home user) → the invite binds their account to this server as a guest
   bound to that profile. Thereafter the viewer is **self-service**: on each
   device they device-code → `whatsontv.net/link` → log in as themselves →
   approve their own device. Removes the admin-approves-every-device bottleneck.
   Also in M7's orbit: a public marketing page at `whatsontv.net` with a Sign-in
   button; per-user **PIN** managed in the cloud account; and (separate follow-on
   milestone) a browser **web player** to watch from the site.
7. **M8 — secure remote data path (DECIDED design).** Goal: **secure delivery
   that works on every device, and everywhere a direct path exists** (relay
   deferred — see decision 4). Per-server, no shared secret:
   - **✅ 8a — DNS publishing DONE + deployed (`dfd8875`).** On heartbeat the
     cloud writes `<serverId>.s.whatsontv.net` **A → real WAN IPv4** (from
     `X-Forwarded-For`; the App Service socket addr is the internal LB
     `169.254.x` — trap) and **AAAA → global IPv6**, into the Azure DNS zone via
     the App Service **managed identity** (DNS Zone Contributor, scoped to the
     one zone). Change-gated so 45s heartbeats don't hammer ARM. Verified end-
     to-end: `<id>.s.whatsontv.net` resolves publicly to the home public IPv4.
     Azure infra (reproduce): `az webapp identity assign`; role assignment of
     "DNS Zone Contributor" on the zone to the MSI principal (had to use a REST
     PUT — the CLI `role assignment create` hit a MissingSubscription quirk);
     app settings `CLOUD_DNS_SUBSCRIPTION_ID` + `CLOUD_DNS_RESOURCE_GROUP`.
   - **✅ 8c — WAN candidate emission DONE & PROD-VERIFIED (`5e8b526`, v0.1.136).**
     Cloud emits the WAN candidate `https://<id>.s.whatsontv.net:<port>` when the
     backend reports `certReady` (heartbeat now carries `certReady`+`remotePort`).
     **Verified end-to-end:** with the owner's port forwarded, an independent
     external fetch (Anthropic infra) reached `:3002` with a valid trusted cert,
     and the cloud logs `candidates=[lan,lan,ipv6,wan]`. **KEY LEARNING:** the
     cloud's OWN reachability probe is unreliable (Azure egress → this home gets
     ECONNRESET/timeout though the port is open to other networks) — reachability
     is **per-client-path**, so emission is NOT gated on it; the client racer is
     the authoritative test and a dead candidate falls through to LAN. The cloud
     probe (`probeWanReachable`, IPv4-forced + SNI + serverId-checked) is kept as
     an advisory diagnostic only.
   - **IPv4 (primary):** the A record is in place. Port forward is still needed —
     the owner did it **manually** today; remaining polish is to **automate** via
     **UPnP/NAT-PMP** where the router allows, else guide the owner.
   - **IPv6 (for CGNAT + where available):** AAAA is published, but from the
     backend's current best-effort v6 which can be a **stable-address bug**
     (`netsh` Public/Preferred on Windows — today's address can be a
     privacy/temporary one that rotates daily) + still needs a firewall
     **pinhole** (Windows Firewall rule; **PCP** to ask the router). Only
     connects when the *client* also has v6.
   - **✅ 8b — per-server DNS-01 TLS cert DONE (`eea8cff`, `c944430` + backend
     commits).** Backend runs its own ACME order (`acme-client`), generates its
     OWN cert keypair (never leaves the box — H1), and completes DNS-01 by asking
     the cloud (server-signed) to publish `_acme-challenge.<id>` (cloud endpoint
     `POST /servers/:id/acme-challenge`). Remote listener terminates HTTPS with
     the cert; `certManager.ts` obtains on enable/boot (background) + renews
     twice-daily under 30 days. `/setup` panel shows cert state. NOT a shared
     wildcard (a leaked backend can't compromise others). **Verified against
     Let's Encrypt STAGING end-to-end** (register→order→dns-01 via cloud→validate
     →finalize = valid PEM cert for `<id>.s.whatsontv.net`, ~27s; TLS listener
     serves it, rejects plaintext). `acme-client` bundles into the esbuild
     standalone build. **✅ PRODUCTION-VALIDATED (shipped v0.1.135):** the user's
     real backend (`8afc87…`) already had remote on, so the 0.1.135 auto-update
     obtained a real cert — `:3002` now serves HTTPS with a Let's Encrypt cert
     for `8afc87….s.whatsontv.net` chaining to ISRG Root X1 (`Verify return
     code: 0 (ok)`), A record → the real public IP. LAN-reachable; internet needs
     8c (port forward). LAN `:3001` untouched, no re-pair (admin pw already set).
   - **BUG to fix:** `registration.ts ipv6Url()` currently emits
     `https://[literal-v6]:port`, which FAILS cert validation (cert is for the
     hostname, not an IP literal). Switch to AAAA-record + hostname candidates.
   - Also: mDNS/SSDP LAN fallback + a `/setup` reachability panel (is my port
     open? is my cert valid? which paths resolve?).
   - **CGNAT residual gap:** CGNAT server + v4-only client = no direct path this
     phase. Detect it and tell the owner "needs IPv6, or wait for relay."

---

## Cloud deployment (live)

The control plane is deployed and verified:
- **Branded URL:** `https://cloud.whatsontv.net` ✅ live, TLS chain validates
  (GeoTrust managed cert, thumb `51FAA213…`, SNI, auto-renews). This is the URL
  backends point `CLOUD_URL` at. Origin is still `whatson-cloud.azurewebsites.net`.
- **Azure:** Extrastrength sub, RG `whatson-cloud-rg`, App Service `whatson-cloud`
  (B1 Linux, Node 22), Always On + WebSockets on + https-only. ~$13/mo.
- **Deploy method:** local `tsc` build → zip of `dist/` + prod `node_modules` →
  `az webapp deploy --type zip` (SCM build off, startup `node dist/index.js`).
- ⚠️ **Signing key** lives in `/home/data/cloud-ed25519.pem` (persistent Azure
  Files). Do NOT wipe `/home/data` — losing it invalidates every issued grant.
  The pinned public key backends need is always at `GET /api/cloud-key`.

### DNS (done — 2026-07-04)
- Domain **`whatsontv.net`** registered at **GoDaddy** (apex/`www`/`cloud` DNS
  stays at GoDaddy; only the machinery subdomain is delegated to Azure).
- **`s.whatsontv.net`** = Azure DNS zone in `whatson-cloud-rg`, delegated from
  GoDaddy via 4 `s` NS records → `ns{1-4}-07.azure-dns.{com,net,org,info}`.
  Verified end-to-end (wrote a temp A record, resolved it publicly, deleted it).
  The cloud will auto-write per-server A/AAAA + the `*.s.whatsontv.net` wildcard
  cert here in M8.
- **`cloud.whatsontv.net`** → GoDaddy CNAME to `whatson-cloud.azurewebsites.net`;
  bound as an App Service custom domain with a free managed cert. (The `asuid`
  TXT wasn't needed — App Service verified off the CNAME.)

- **Next to make it usable end-to-end:** (1) ✅ DNS done. (2) ship backend
  v0.1.133 (M4 registration client + M5 health echo, dormant) so a real backend
  *can* register. (3) point the backend at it — `CLOUD_URL=https://cloud.whatsontv.net`,
  `CLOUD_PUBLIC_KEY=<GET /api/cloud-key>`, `REMOTE_ACCESS=true`, admin password —
  so it registers + heartbeats. (4) build the client device-code onboarding to
  fetch `/candidates`; the **LAN candidate proves the whole path with no cert**.
  (5) M8 for the WAN path (per-server DNS records + wildcard cert).

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
