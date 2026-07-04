# 04 — Implementation Plan (synthesised from a 4-way design review)

**Status:** planning. This document turns docs 01–03 into a buildable,
milestone-ordered plan. It is the output of a review team that graded the design
docs against the *current* code and against distributed-systems / security /
client-parity concerns.

**Verdict up front.** The design is sound and unusually well-grounded — it is the
proven Plex/Syncthing shape (rendezvous + address book + client-side candidate
racing, direct data path, cloud starved by design) and it deliberately fixes
Plex's offline weakness with on-device caching. Every file/function/line anchor
in docs 01–03 was verified to still exist and be accurate, with a small number of
corrections listed below. The plan below keeps the docs' intent but re-scopes v1
so a **browse-remotely** milestone ships fast, and it folds in the security and
architecture findings the original docs missed.

---

## A. Corrections to docs 01–03 (verified against current code)

These are factual drifts / imprecisions found during grounding. Fix the source
docs when convenient; the plan already accounts for them.

| # | Where | Doc says | Reality in code | Consequence |
|---|-------|----------|-----------------|-------------|
| A1 | 01 "Routes NEVER mounted" & Item 3 | `GET /api/config` "returns service tokens — catastrophic if exposed" | `config.ts:20-71` **masks every secret** as `••••<last4>`. No endpoint returns a full token. The `/config/save` **write** path does accept plaintext. | Keeping `config` off the remote listener is still correct, but for the right reason: **write surface + recon** (internal URLs/IPs, usernames, last-4), not token read-out. Don't design a guest-role test around reading a full token. |
| A2 | 01 Item 4 | WO PIN "only checked in the app's picker UI, never server-side" | A server-side check exists — `POST /whatson-users/:id/select` → `wo.verifyPin` (`whatsonUsers.ts:186`) — but it's toothless: it warms a token cache and binds nothing; `userContext` (`:40-90`) trusts `X-Whatson-User` directly and never consults it. `verifyPin(user, pin)` takes a **user object**, not an id. | The impersonation vuln is fully real. The fix is to make `userContext` enforce a device→profile allow-set; `/select` is the existing (bypassable) endpoint to harden, not a missing one. |
| A3 | 01 Item 8 / §9 | Follow the `hlsProxy.ts` "stream + segment passthrough" precedent | `hlsProxy.ts` is an **ffmpeg transmux-to-disk** (re-encodes, writes segments to `<data>/livetv-hls/`, serves off disk) — not a byte-pipe to the media server. | The remote stream proxy (Item 8) is **genuinely new code**, sized **L**. The reusable pattern is the unguessable-`sessionId`-in-path + `?auth=` capability model (`live.ts:201-219`, `apiAuth.ts:43`), not a byte-forwarding function that already exists. |

Everything else in docs 01–03 verified accurate to the line, including: the
`X-Whatson-Auth` gate and its open-when-no-admin-password bypass, the `?auth=KEY`
fallback and `PUBLIC_PATH_PREFIXES=['/live/hls/']`, pairing's 6-digit→256-bit key
+ SHA-256 hash + single-active + 10-min TTL, the unsalted PIN `sha256` at
`whatsonUsers.ts:81-83`, the artwork SSRF (`startsWith` prefix bypass + axios
default-follow-redirects), the single `express()` app with bare `cors()` at
`index.ts:77`, and the direct-media-server `streamUrl` builds at `plex.ts:750` /
`embyLike.ts:925`. `bcryptjs@^3.0.3` is already a dependency.

---

## B. Findings the docs missed (added to the plan)

### Security (from the security review)

- **[CRITICAL] Grant signature algorithm confusion.** Doc 02 §5 says "JWT or
  equivalent." A permissive `jwt.verify(token, cloudPubKey)` is forgeable via
  `alg:HS256` (HMAC the token with the *public* key) or `alg:none`, yielding an
  **owner** device key at `redeem-grant`. **Mitigation:** pin a single asymmetric
  algorithm with an explicit allowlist (`algorithms:['EdDSA']`), or skip JWT
  entirely and use a raw Ed25519 detached signature over canonical JSON (no `alg`
  field to confuse). Make this an acceptance criterion.
- **[HIGH] TLS private-key custody.** If the cloud generates per-server certs and
  pushes cert+**key** down the WSS, the cloud holds every home's TLS key —
  breaking "cloud is untrusted" and foreclosing the v2 SNI-passthrough relay.
  **Mitigation:** backend generates the keypair locally, sends only a **CSR**; the
  cloud does DNS-01 and returns the signed cert. Key never transits the wire.
- **[HIGH] Don't mount the LAN 6-digit pair flow on the remote listener.**
  `completePair` mints an **owner**-default key guarded only by a 6-digit code
  (10⁶) in a 10-min window. Remote onboarding must be grant/device-code **only**.
  Correct doc 01's "consumer routes allowed on remote" to `auth: providers +
  redeem-grant + device-code` — not `pair`.
- **[HIGH] Grant replay + revocation hole.** Grants have no `jti`; `redeem-grant`
  mints a fresh key every time one is presented. And `DeviceGrant.revokedAt` lives
  in the cloud but the backend verifies offline and never re-checks — so revoking
  a guest in the cloud does nothing. **Mitigation:** add `jti`, persist redeemed
  `jti`s (single-use), keep grant `exp` to minutes, and make **backend device
  revocation** (`pairing.ts:221`) the real "kick out a guest" control, surfaced in
  the owner UI.
- **[HIGH] WebSocket `/ws` bypasses the whole model.** `initWebSocket`
  (`ws.ts:16`) attaches with no `verifyClient`; a WS `Upgrade` never passes
  through `userContext`/`apiAuth`, and the two-listener "not mounted" invariant
  doesn't cover it (WS binds to the HTTP *server*, not the Express *app*). On 3002
  that's an unauthenticated, unbounded connection sink. **Mitigation:** either
  don't attach WS to the remote listener at all (clients poll), or validate a
  token/device key on the upgrade request.
- **[MED] Per-IP rate limiting is wrong behind CGNAT** (the exact users v2 targets
  share one public IPv4) and is a DoS lever. Rate-limit **per-credential** (per
  code / token / account) with self-healing backoff; per-IP only as a coarse
  ceiling.
- **[MED] `trust proxy` unset.** `req.ip` and any `X-Forwarded-For`-derived
  local/remote decision are spoofable behind a TLS terminator. Set `trust proxy`
  narrowly, and derive local-vs-remote from the **surface** (a request on 3002 is
  remote by construction), never from `req.ip`.
- **[MED] Signed URLs are unbound bearer tokens.** `hmac(path+exp)` is globally
  replayable within its TTL. Bind a device/session id into the payload, keep media
  TTL to minutes, verify with `crypto.timingSafeEqual` (copy `session.ts:85`),
  canonicalise the signed string. Keep artwork TTL short too.
- **[MED] DNS-rebinding.** CORS only stops cross-origin *reads*; a rebind page can
  still *issue* mutating requests to the open LAN backend. Add **Host-header
  validation** on the LAN listener. For the artwork SSRF fix, resolve the
  whitelisted host to an IP yourself and pin it at connect time (guards the
  redirect/TOCTOU case). CORS is defence-in-depth, not the control.
- **[MED] Claim-code / cloud-pubkey trust.** `serverId=hash(pubkey)` is
  discoverable (it's in the DNS name), so ownership hinges on the claim code —
  make it high-entropy, single-use, short-TTL, LAN-only, rate-limited. The backend
  must authenticate the cloud (pin the cloud cert/pubkey shipped in the app build)
  before trusting any pushed cloud pubkey — never TOFU it over plain WSS.
- **[NEW STRUCTURAL ITEM] "Surface hardening" bundle.** A route-mounting-only
  mental model lets three things slip through the cracks: **(1)** a global Express
  error handler (none exists today → default handler leaks stack traces; several
  handlers already return `(error as Error).message`), **(2)** WS-upgrade auth
  (above), **(3)** `trust proxy`. Bundle these with mandatory-auth + rate-limiting
  as a **hard prerequisite the remote listener refuses to start without** (doc 01
  Item 2 already establishes refuse-to-start; extend the check).

### Architecture (from the cloud review)

- **[P0] Candidate identity verification.** The racer accepts any candidate that
  returns `200 /api/health`. On a foreign LAN, the cached `192.168.x.y:3001` may be
  a **stranger's** device → the app attaches its auth key to the wrong server.
  **Fix:** `/api/health` must echo `serverId`; the racer rejects any candidate
  whose `serverId` ≠ expected. Small, mandatory.
- **[P1] mDNS/SSDP LAN fallback.** On-device caching only saves offline-on-LAN if
  the LAN IP is stable. DHCP moves the server + internet down = the cache is dead
  and the cloud can't repair it — the exact scenario caching was meant to save. A
  zero-conf LAN discovery fallback (Plex's GDM) closes the one real hole in "works
  offline on the LAN."
- **[P1] `DeviceGrant` needs an app-facing cloud token.** Residential WAN IPs
  change, so the app must periodically re-fetch `/candidates` from the cloud — but
  nothing authenticates that ongoing call today. Add a per-grant cloud
  bearer/refresh token. Stale candidates after an IP change are the single most
  likely field failure.
- **[P1] Windows IPv6 is a trap, and IPv6 is the CGNAT rescue.**
  `os.networkInterfaces()` returns SLAAC **temporary/privacy** addresses (rotate
  ~daily) with no flag to distinguish them; advertising one breaks remote clients
  within a day. Must shell to `netsh interface ipv6 show addresses` and pick the
  Public/Preferred address, needs a firewall pinhole, and must be **externally
  probed** (§4.5 must probe the IPv6 candidate, not only WAN IPv4). Treat IPv6 as
  best-effort + verified, never "just works."
- **[P1] §7 cert fleet is the hidden mountain (XL, biggest slip risk).** Per-server
  DNS-01 is certificate-*fleet* management: dynamic DNS on every IP change, ACME
  per server, 90-day renewals × N servers, and Let's Encrypt rate limits
  (50 certs/domain/week, 5 duplicates/week) that bite during scale-up. **Cut it
  from v1.0.** Ship browse-remotely over **BYO-TLS** (Cloudflare Tunnel / Caddy /
  user reverse proxy — doc 01 already permits) or a **single wildcard
  `*.s.<clouddomain>`** (one cert, no per-server ACME; only cost is blast radius,
  and it is **still compatible with the v2 SNI-passthrough relay**). Cert *push*
  over WSS + `https.Server.setSecureContext()` hot-swap is fine; issuance at fleet
  scale is the cost.
- **[P1] Racing latency + storms.** "Prefer lowest-priority that answers" taken
  literally waits out the full timeout before falling back — use **staged
  (happy-eyeballs) racing**: fire LAN first with a ~150–250 ms head start, then
  WAN/IPv6. Debounce network-change re-races (~1–2 s), cancel in-flight, skip if
  the pinned candidate still health-checks.
- **[P1] Keep the relay data plane off the Azure control socket.** Doc 03's
  "reuses that outbound connection" means the *property* (outbound works behind
  CGNAT), **not** muxing video through the Azure-hosted WSS (that pays the exact
  hyperscaler egress doc 03 says to avoid). v1 keeps the control WSS control-only;
  v2 opens a *second* tunnel to a cheap-bandwidth relay node.
- **[P2] Frame + version the control channel now.** Wrap every message in a typed,
  versioned envelope `{ v, type, id?, payload }` from day one so v2 can add
  `relay-open`/`relay-data` without a protocol break. Cheap now, painful to
  retrofit.
- **[P2] Data-model gaps:** add `Server.enabled/revokedAt` (owner disables remote →
  cloud stops resolving) and cloud-side rate-limit state for device-code polling.
- **Do NOT host the persistent WSS on Azure Functions** (request-scoped, poor fit
  for long-lived sockets). Use App Service or a small container. Control plane cost
  is single-digit $/month and fits the user's existing Azure footprint.

### Client (from the client/Roku review)

- **Browse-remotely needs ~zero new client code** — both apps already resolve one
  HTTPS base URL and stamp `?auth=` on posters. The demo is unblocked by
  **configuration**, not code (point the URL at a remote listener + pair).
- **Candidate manager** can be lifted almost verbatim from the existing mobile Plex
  `/identity` racer (`_layout.tsx:187-204`). Because every call site funnels
  through `getBaseUrl()` (mobile) / `m.apiUrl` (Roku), the winner just writes back
  to that one field — **no call sites break**. Roku has no racing primitive
  (parallel `ApiTask` nodes) → **L**; mobile → **M**.
- **Signed URLs are computed server-side** (client has no `serverSecret`): the
  backend embeds `?exp=&sig=` into the artwork/stream URLs it already returns; the
  client just stops appending its own `?auth`. **But: HLS segment URIs must be
  signed inside the playlist** — neither `expo-video` nor Roku's `Video` loader can
  inject `?sig` into segment sub-requests. Backend obligation, parity-affecting.
- **Expiry mid-session** (poster still on screen, long movie past TTL) needs a
  client refresh strategy — bumps signed-URL client work to **M** each.
- **Offline regressions the docs create:** a single stored URL holding the WAN
  address + internet down = no automatic LAN fallback (net-new cache work); and
  mobile currently bounces to `/pair-device` on any unreachable `/auth/admin-status`
  — for an already-paired device that must become a dedicated "can't reach your
  server" state, not re-onboarding.
- **Roku parity risks to record in `apps/roku/PLAN.md`:** backend-side segment
  signing; candidate racing via parallel ApiTasks; **QR scanning impossible on TV**
  (Roku/AndroidTV/tvOS) → remote onboarding is device-code-display + keyboard entry
  only; verify raw IPv6-literal URLs in `roUrlTransfer` if ever used (design uses
  hostnames — fine); LE per-server/wildcard cert satisfies Roku's cert store (no
  channel change) but is a hard dependency before Roku remote works.

---

## C. Milestone plan

Re-scoped so a useful **browse-remotely** milestone ships without the two heaviest
components (cert fleet §7, stream proxy Item 8). Owner-only first; guests/invites
deferred to v1.1. Sizes: S/M/L/XL.

### M0 — Standalone security fixes (ship now, independent of everything)
No dependency on the cloud or the listener split. Land immediately.
- **Item 1 — artwork SSRF** (S). Origin whitelist + `maxRedirects:0` + resolve-and-pin
  host IP at connect time (DNS-rebind/TOCTOU) + attach api_key only when the
  **final** origin matches. *Live exploitable bug on the current LAN surface — the
  moment 3002 opens it becomes an internet-reachable SSRF into the home LAN, so its
  DNS-rebind completeness gates enabling remote.*
- **Item 6 — CORS allowlist** (S) + Host-header validation on LAN (anti-rebind).
- **Item 7 — bcrypt PINs** (S) with transparent SHA-256→bcrypt migration on verify.

### M1 — Two-listener split + surface hardening (M)
The structural control everything leans on.
- Refactor `index.ts` to `mountRoutes(app, surface: 'lan'|'remote')`; 3001 = today's
  behaviour byte-for-byte, 3002 = consumer routes only.
- **Surface hardening bundle** (the new structural item): global error handler
  (generic message on remote, log details, `NODE_ENV=production`), WS-upgrade
  auth / don't attach WS to remote, `trust proxy` set narrowly.
- Remote listener **refuses to start** unless mandatory-auth + rate-limiting +
  WS-decision + error-handler are all in place.
- *Risk:* the LAN hot path. Guard with doc 01's acceptance test — `/config`,
  `/logs`, `/debug/*`, `/setup` all **404** on 3002; 3001 unchanged.

### M2 — Mandatory auth, roles, profile binding — owner-only (M)
- **Item 2:** `apiAuth({surface})`; remote never enters open mode.
- **Item 3:** add `role:'owner'|'guest'` + `boundWoProfileId` to `PairedDevice`
  (migrate existing → owner); `requireOwner` on admin routers (belt-and-suspenders).
- **Item 4:** `userContext` enforces a device→profile allow-set (owner=all,
  guest=bound one); harden the existing bypassable `/whatson-users/:id/select`;
  move PIN verification server-side on remote.
- **Item 9 (partial):** per-credential rate limiting + lockout with self-healing
  backoff on `/auth/*`, PIN-verify, device-code redeem. *Must land with the remote
  listener, not after.*

### M3 — Cloud control plane (L)
On the user's existing Azure (App Service or small container — **not** Functions
for the WSS). Accounts, claim (high-entropy single-use LAN-only code + cloud-pubkey
pinning), `Server` registry, `GET /candidates`, external reachability probe
(IPv4 **and** IPv6), typed/versioned message envelope, `Server.enabled/revokedAt`.
Data model per doc 02 §4.1 + the app-facing cloud refresh token on `DeviceGrant`.

### M4 — Backend registration + grants + remote pairing (M)
- Backend: server identity (keypair, `serverId=hash(pubkey)`), persistent outbound
  WSS **client** with backoff/jitter/ping-pong, heartbeat, NIC enumeration.
- **Grants:** Ed25519 detached signature (pinned algorithm — no permissive JWT),
  `jti` single-use, minutes-long `exp`, backend verifies offline against the pinned
  cloud pubkey.
- `POST {backend:3002}/api/auth/redeem-grant` → verify → provision device via
  `pairing.ts` with role + bound profile → return one-shot key. **LAN 6-digit pair
  flow is NOT mounted on remote.**

### M5 — Client connection manager (M mobile / L Roku)
- Candidate list + **staged racing** + **serverId identity check** + on-device
  cache + network-change debounce; winner writes back to the single base-URL field.
- Derive `plexConnectionType` from the winning candidate kind.
- Dedicated **"can't reach your server"** offline state (stop the pair-device
  bounce for paired devices).
- Mobile lifts the existing Plex `/identity` racer; Roku builds parallel-ApiTask
  racing.

### ▶ BROWSE-REMOTELY DEMO (over BYO-TLS or a single wildcard cert)
Everything above + a TLS front (user reverse proxy / Cloudflare Tunnel, or wildcard
`*.s.<clouddomain>`). No §7 fleet, no stream proxy, no invites. Owner reaches their
own backend from anywhere and browses; posters load via `?auth`/signed URLs.

### M6 — Remote playback (L) — the second heavy component
- **Item 8:** per-adapter (Plex/Jellyfin/Emby) stream + **segment** proxy through
  the backend (genuinely new code; the `hlsProxy.ts` transmux is not reusable as a
  byte pipe). Segment URIs rewritten **inside the playlist**.
- **Item 5:** short-lived HMAC signed URLs, device/session-bound,
  `timingSafeEqual`, per-install `serverSecret`. LAN keeps direct URLs.
- After this, play-remotely works with only 3002 forwarded.

### M7 — Guests: invites + device-code + roles UI (L) — v1.1
- Cloud invites (`boundWoProfileId`), RFC 8628 device-code (longer/high-entropy
  codes, cloud-side rate limit).
- App onboarding UIs (invite redeem + device-code) — **device-code + keyboard on
  TV; QR/scan only where a camera exists**; new cloud API client separate from the
  backend `api` object.
- Guest revocation = backend device revocation, surfaced in owner UI.

### M8 — Reachability hardening — v1.1 / ongoing
- UPnP/NAT-PMP best-effort (`nat-api`); lead with the reachability-probe **panel**
  in `/setup` (the honest CGNAT answer).
- Windows stable-IPv6 selection (`netsh` Public/Preferred) + firewall pinhole +
  external IPv6 probe.
- mDNS/SSDP LAN discovery fallback (closes the dynamic-DHCP offline hole).
- **§7 per-server DNS-01 cert fleet** (XL) as the managed-TLS upgrade over the
  wildcard/BYO-TLS shortcut, with backend-generated key + CSR-only (never ship the
  key to the cloud).

### v2 — Relay (doc 03)
Separate outbound tunnel to cheap-bandwidth hosts, `kind:'relay'` candidate
(lowest priority), bitrate cap, SNI passthrough, per-account metering. Nothing in
v1 forecloses it provided the control channel is framed/versioned and the cert flow
never assumes TLS terminates only at the backend's own listener.

---

## D. Critical path & what to cut

```
M0 (SSRF etc, parallel)
      │
      ▼
M1 two-listener + surface hardening
      │
      ▼
M2 mandatory auth + roles + profile-binding (owner-only)
      │
      ▼
M3 cloud control plane (accounts, claim, registry, /candidates, probe)
      │
      ▼
M4 backend identity + WSS + grants + remote-pair
      │
      ▼
M5 client connection manager (race + cache + serverId check)
      │
      ▼ (over BYO-TLS or wildcard cert)
  ★ BROWSE-REMOTELY DEMO
      │
      ▼
M6 remote stream proxy + signed URLs → PLAY-REMOTELY
```

**Cut from v1.0 / defer past the demo:** §7 per-server cert fleet (use BYO-TLS or
wildcard), UPnP/NAT-PMP, the IPv6 candidate, invites + guest roles + device-code,
and the remote stream proxy. **Riskiest / most-likely-to-slip:** the §7 cert
automation (XL → M via wildcard) and the Windows IPv6 temporary-address trap (a
correctness bug that hides for a day then surfaces). The cloud control plane — the
part that *sounds* like the big lift — is the least risky major piece.

**Two highest-leverage correctness/security musts that make "cloud is untrusted"
real rather than aspirational:** pin the grant signature algorithm (Ed25519,
explicit allowlist) and keep the TLS private key on the backend (CSR-only). Add the
serverId identity check on the client racer as the third non-negotiable small item.

---

## E. Consolidated risk register

| Sev | Risk | Where | Mitigation | Milestone |
|-----|------|-------|-----------|-----------|
| CRIT | Grant algorithm confusion → forged owner key | 02 §5 | Ed25519 detached sig / pinned `alg` allowlist | M4 |
| HIGH | Cloud holds every home's TLS key | 02 §7 | Backend keypair + CSR-only | M8 |
| HIGH | LAN 6-digit pair reachable on internet | 01 remote allowlist | Don't mount pair on remote; grant/device-code only | M1/M4 |
| HIGH | Grant replay + dead cloud revocation | 02 §5 | `jti` single-use; backend device revoke is the control | M4/M7 |
| HIGH | `/ws` upgrade bypasses auth on 3002 | ws.ts | Upgrade auth or don't attach WS to remote | M1 |
| P0 | Racer connects to wrong server on foreign LAN | 02 §2 | `serverId` echo in `/health`, verify in racer | M5 |
| P1 | §7 cert fleet slips the schedule | 02 §7 | Wildcard / BYO-TLS for v1.0; DNS-01 later | demo→M8 |
| P1 | Windows temporary-IPv6 breaks remote in a day | 02 §3 | `netsh` Public/Preferred + external probe | M8 |
| P1 | Stale candidates after WAN-IP change | 02 §4 | App-facing cloud refresh token on DeviceGrant | M3 |
| P1 | Offline-LAN cracks under DHCP move | 02 §2 | mDNS/SSDP fallback | M8 |
| MED | Per-IP lockout breaks CGNAT / enables DoS | 01 Item 9 | Per-credential backoff, per-IP only as ceiling | M2 |
| MED | `trust proxy` / XFF spoofing | index.ts | Set trust proxy narrowly; decide local/remote by surface | M1 |
| MED | Signed URL = global bearer within TTL | 01 Item 5 | Bind device/session, minutes TTL, timingSafeEqual | M6 |
| MED | DNS rebinding to open LAN backend | 01 Item 6 | Host-header validation (not just CORS) | M0/M1 |
| MED | Claim squatting / cloud-pubkey TOFU | 02 §4.2 | High-entropy single-use claim code; pin cloud cert | M3 |
| MED | Stack-trace / error leakage on 3002 | index.ts | Global error handler + NODE_ENV=production | M1 |

---

## F. Effort table (per component)

| Component | Size | Milestone |
|-----------|------|-----------|
| Item 1 artwork SSRF | S | M0 |
| Item 6 CORS + Host-header validation | S | M0/M1 |
| Item 7 bcrypt PINs | S | M0 |
| Two-listener split + surface hardening | M | M1 |
| Items 2/3/4 auth + roles + profile-binding | M | M2 |
| Item 9 per-credential rate limiting | S–M | M2 |
| Cloud control plane (API + DB + WSS server + deploy) | L | M3 |
| Backend identity + WSS client + heartbeat | M | M4 |
| Grants (Ed25519) + offline verify + remote-pair | M | M4 |
| Client connection manager — mobile | M | M5 |
| Client connection manager — Roku | L | M5 |
| Item 8 remote stream proxy (per adapter) | L | M6 |
| Item 5 signed media/segment URLs (server) + client refresh | M | M6 |
| Invites + device-code (cloud + two app UIs) | L | M7 |
| UPnP/NAT-PMP (`nat-api`) | M | M8 |
| Windows stable-IPv6 + firewall + probe | M | M8 |
| mDNS/SSDP LAN fallback | M | M8 |
| §7 DNS + per-server DNS-01 cert fleet + renewal + push | XL (M via wildcard) | demo→M8 |
| `/setup` reachability-status panel | S | M8 |
| Browse-remotely demo (client) | S (config only) | demo |
