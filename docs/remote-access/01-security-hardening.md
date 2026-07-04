# 01 - Backend Security Hardening

**Status:** v1, do this first. Several items are live vulnerabilities *today*,
independent of the cloud service.

**Audience:** implementer. This doc is prescriptive. Each item has: the problem,
the file(s), the fix, and acceptance criteria.

---

## Context: what already exists

The backend is **not** a blank slate on auth. Before writing anything, read:

- `packages/api/src/middleware/apiAuth.ts` - the `X-Whatson-Auth` gate. Enforced
  **only when an admin password is set** (`config.auth.adminPasswordHash`).
  Otherwise every `/api/*` request passes. Has an allowlist of public paths
  (health, auth flow, update status) and a `?auth=KEY` query fallback for
  players that can't set headers.
- `packages/api/src/services/pairing.ts` - device pairing. 6-digit code ->
  256-bit auth key, stored only as SHA-256 hash in `paired-devices.json`.
  `verifyAuthKey()`, `revokeDevice()`, one pending code at a time, 10-min TTL.
- `packages/api/src/routes/auth.ts` - admin password (bcrypt) + session cookies,
  the pairing endpoints, device list/revoke.
- `packages/api/src/middleware/userContext.ts` - resolves `X-Whatson-User` (WO
  profile) and `X-Plex-User` (legacy) into per-request scope.
- `packages/api/src/services/whatsonUsers.ts` - WO profiles + PINs.

So the model is: **admin password gates a per-device auth-key system, but it's
opt-in and off by default.** The hardening below closes the gaps that remain
once the port faces the internet.

---

## The core architectural decision: two listeners

Do **not** try to secure the internet-facing surface by auth-gating the existing
single server route-by-route. You will miss one, and a new route added later
will silently be exposed. Instead split the surface *physically* so admin routes
are not reachable from the internet **by construction**.

### Design

- **LAN listener - port 3001 (unchanged).** Exactly today's behavior. Binds all
  routes, including `/setup`, `/api/config`, `/api/logs`, `/api/debug`. Auth
  stays opt-in (the existing `apiAuth` behavior). This is what preserves
  offline-on-LAN operation and makes the feature-off path byte-for-byte
  identical to today.

- **Remote listener - port 3002 (new, the only port ever forwarded).** Mounts
  **only consumer routes**. Auth is **mandatory** (never opt-in). An admin route
  cannot be exploited from the internet because it is not mounted on this
  listener at all.

### Consumer routes allowed on the remote listener

Mount these (the read/playback surface an app needs):

```
health (liveness only), auth (pair + providers + device-code redeem),
home, tv, movies, search, library, recommendations, discover,
playback, scrobble, tracked, artwork (hardened - see SSRF below),
live, sports, users (read-only list), whatsonUsers (read-only list + PIN verify)
```

### Routes NEVER mounted on the remote listener

```
config  (returns service tokens - catastrophic if exposed)
logs    (internal paths, IPs, recon)
debug   (fetches Plex metadata with the admin token on demand)
setup   (static admin UI)
update  (apply/check - remote code execution surface)
add     (Sonarr/Radarr writes - optional; gate behind owner role if included)
whatsonUsers CRUD (create/update/delete profiles - owner only)
users/select and any write ops
```

### Implementation shape

Refactor `packages/api/src/index.ts` so route mounting is a function of a
"surface" flag. Sketch:

```ts
function mountRoutes(app: express.Express, surface: 'lan' | 'remote') {
  app.use('/api', userContext);
  app.use('/api', apiAuth({ surface }));   // see "mandatory auth" below

  // Consumer routes - both surfaces
  app.use('/api', healthRouter);
  app.use('/api', homeRouter);
  // ... tv, movies, search, library, recommendations, discover,
  //     playback, scrobble, tracked, artworkRouter, liveRouter,
  //     sportsRouter, authRouter, usersRouter(read), whatsonUsersRouter(read)

  if (surface === 'lan') {
    // Admin-only surface - LAN listener exclusively
    app.use('/api', configRouter);
    app.use('/api', logsRouter);
    app.use('/api', debugRouter);
    app.use('/api', updateRouter);
    app.use('/api', addRouter);            // or gate behind owner role on remote
    app.use('/api', whatsonUsersAdminRouter);
    mountSetupStatic(app);
  }
}

const lan = express();  mountRoutes(lan, 'lan');
const remote = express(); mountRoutes(remote, 'remote');

createServer(lan).listen(config.port);            // 3001
if (config.remote.enabled) {
  createHttpsServer(tlsOpts, remote).listen(config.remotePort);  // 3002, TLS
}
```

The remote listener only starts when remote access is enabled (see doc 02). TLS
material for it comes from the per-server cert flow in doc 02; until that exists,
the remote listener can run plain HTTP **only** behind something already
providing TLS, but the shipping default must be TLS.

### Acceptance criteria

- With remote listener enabled, `GET https://<host>:3002/api/config` returns
  404 (route not mounted), not 401/200.
- `GET https://<host>:3002/api/logs`, `/api/debug/*`, `/setup` all 404.
- `GET http://<host>:3001/api/config` behaves exactly as today.
- Disabling remote access stops the 3002 listener entirely.

---

## Item 1 - Artwork proxy SSRF + credential reflection (LIVE BUG, fix first)

**File:** `packages/api/src/routes/artwork.ts` (`GET /artwork`, `buildFetchConfig`).

**Problem.** The handler fetches an arbitrary caller-supplied `url` query
parameter server-side. Two distinct issues:

1. **SSRF.** `?url=http://192.168.1.1/...` or a cloud metadata endpoint
   (`http://169.254.169.254/...`) makes the backend issue that request from inside
   the LAN and return the body. The backend becomes an open proxy into the home
   network and localhost.
2. **Credential reflection.** `buildFetchConfig()` (lines ~49-69) appends the
   user's Jellyfin/Emby `api_key` when the URL *starts with* the configured
   server URL. A URL crafted to prefix-match (or a redirect target) can exfil the
   key, and the key is attached to a request whose destination the attacker
   influences.

**Fix.**

- Whitelist the destination host. Resolve the configured Plex server URL
  (`getServerUrl()`), `config.jellyfin.url`, `config.emby.url`, and the Plex
  image hosts actually in use. Reject any `url` whose parsed origin is not an
  exact match (scheme + host + port) against that set. Return 400.
- Block private/link-local/loopback targets defensively even within the
  whitelist: reject resolved IPs in `10/8`, `172.16/12`, `192.168/16`,
  `127/8`, `169.254/16`, `::1`, `fc00::/7`, `fe80::/10` **unless** the configured
  media server legitimately lives there (it usually does on a LAN - so the
  origin whitelist is the primary control; this is belt-and-suspenders for the
  redirect case).
- Disable following cross-origin redirects (`maxRedirects: 0`, or validate each
  hop against the whitelist). Axios follows redirects by default - a whitelisted
  host that 302s to `169.254.169.254` currently defeats the check.
- Only attach the `api_key` when the **final** destination origin equals the
  configured Jellyfin/Emby origin. Never attach it to a URL that merely starts
  with the configured string (`startsWith` is not an origin check).

**Acceptance criteria.**

- `?url=http://169.254.169.254/latest/meta-data/` -> 400, no outbound request.
- `?url=http://<jellyfin-host>.evil.com/x` -> 400 (not a prefix bypass).
- Legitimate Plex/Jellyfin/Emby poster URLs still resolve and cache as today.
- A whitelisted URL that redirects off-origin does not carry the api_key.

> This item is worth shipping on its own, ahead of the cloud work - it's
> exploitable by anything that can already reach `/api/artwork` on the LAN.

---

## Item 2 - Mandatory auth on the remote listener

**Files:** `packages/api/src/middleware/apiAuth.ts`, `index.ts`.

**Problem.** `apiAuth` early-returns (open mode) when no admin password is set.
That's the right default for a LAN appliance, but on the internet-facing listener
it must never be optional.

**Fix.**

- Parameterize `apiAuth` by surface: `apiAuth({ surface })`. On `surface:
  'remote'`, skip the `if (!adminPasswordHash) return next()` bypass - auth is
  always required. If remote access is enabled without the prerequisites
  (admin password, device grants), the remote listener should refuse to start
  rather than run open.
- Keep the LAN surface behavior unchanged (opt-in).
- Keep the existing `?auth=KEY` query fallback - it's required for Roku's Poster
  and Video nodes and HLS segment loaders, which can't set headers. But see
  Item 5: signed URLs are the better long-term answer for media specifically.

**Acceptance criteria.**

- Remote listener with a missing/blank auth key -> 401 on every non-public path.
- Remote listener never enters open mode regardless of `ADMIN_PASSWORD_HASH`.

---

## Item 3 - Role separation: owner vs guest device

**Files:** `services/pairing.ts`, `middleware/apiAuth.ts`, admin routes.

**Problem.** Today any valid auth key = full access. A paired *guest* device can
call `GET /api/config` and read every service token, or hit `/api/logs`. There is
no notion of privilege level on a device.

Once the two-listener split (above) lands, the worst of this is contained -
`/api/config` etc. aren't on the remote listener. But a guest device paired on
the LAN can still read admin routes, and the invite flow in doc 02 mints guest
grants that must not carry admin power.

**Fix.**

- Add a `role: 'owner' | 'guest'` field to the `PairedDevice` record (default
  existing records to `owner` on migration - they were paired by the admin at
  `/setup`, so that's accurate).
- Admin-surface routes (`config`, `logs`, `debug`, `update`, `whatsonUsers`
  CRUD, `add` writes) require **session cookie OR owner-role device key**. Guest
  keys get 403. Add a `requireOwner` middleware and apply it to those routers
  (belt-and-suspenders alongside the not-mounted-on-remote rule).
- Guest devices are additionally constrained to their bound WO profile - see
  Item 4.

**Acceptance criteria.**

- Guest-role auth key -> 403 on `/api/config`, `/api/logs`, `/api/debug/*`,
  `/api/whatsonUsers` writes, even on the LAN listener.
- Owner-role auth key and admin session -> unchanged access.

---

## Item 4 - Bind `X-Whatson-User` to the device (stop profile impersonation)

**File:** `packages/api/src/middleware/userContext.ts` (lines ~40-90).

**Problem.** `X-Whatson-User` is a client-asserted profile id with no proof. Any
caller can send `X-Whatson-User: wo-<anything>` and *become* that profile -
reading its watched history and the content of the Plex/Jellyfin/Emby user it
maps to. The WO PIN is only checked in the app's picker UI, never server-side.
On a LAN this is acceptable; remotely it is a data-leak.

**Fix.**

- When a device auth key is present, resolve which WO profiles that device is
  allowed to act as. For owner devices: all profiles. For guest devices: exactly
  the one profile bound at invite-redemption time (stored on the device record,
  or on the grant - see doc 02).
- In `userContext`, if the requested `X-Whatson-User` is not in the device's
  allowed set -> 403. Do not silently fall back to another profile.
- Move PIN verification server-side for profile *switching* over the remote
  listener: entering a PIN-protected profile requires posting the PIN to an
  endpoint that checks it (`verifyPin` already exists in `whatsonUsers.ts`) and
  returns a short-lived grant, rather than trusting the client to have gated it.

**Acceptance criteria.**

- Guest device sending `X-Whatson-User` for a profile it isn't bound to -> 403.
- Owner device can switch among all profiles (PIN checked server-side for
  protected ones on the remote listener).
- LAN listener behavior with the feature off is unchanged.

---

## Item 5 - Signed URLs for media/segment fetches

**Files:** `routes/playback.ts`, `routes/artwork.ts`, `routes/live.ts` (already
uses an unguessable session id in the path - good precedent, see
`apiAuth` `PUBLIC_PATH_PREFIXES = ['/live/hls/']`).

**Problem.** Video players and image loaders (Roku, ExoPlayer, `expo-video`)
fetch stream/segment/poster URLs **without** the ability to attach the
`X-Whatson-Auth` header. Today the workaround is `?auth=KEY` in the query. That
works but sprays the long-lived device key across many URLs, logs, and any
intermediary - worse once those URLs traverse the internet.

**Fix.**

- For media and segment URLs, mint **short-lived HMAC-signed URLs** scoped to a
  session: `...?exp=<unix>&sig=<hmac(path+exp, serverSecret)>`. Validate `exp` and
  `sig` in middleware; no device key in the URL. TTL on the order of minutes,
  refreshed as playback continues.
- Keep the existing `/live/hls/<sessionId>/...` pattern (the session id already
  functions as a capability token) but ensure the session id is high-entropy and
  expires.
- The `serverSecret` is a per-install random value; generate once and persist
  (same data dir as `paired-devices.json`).

**Acceptance criteria.**

- A captured media URL stops working after its `exp`.
- No long-lived device auth key appears in any media/segment/poster URL on the
  remote listener.
- Roku playback and posters still load.

---

## Item 6 - Lock down CORS

**File:** `packages/api/src/index.ts` line 77 (`app.use(cors())`).

**Problem.** `cors()` with no options reflects any origin and allows credentials
patterns broadly. Combined with the LAN's open-by-default posture, a web page a
user visits could script requests against their backend.

**Fix.**

- Restrict to known app origins: the web SPA's own origin, and the remote
  hostname scheme from doc 02 (`https://<id>.s.<clouddomain>`). Native apps
  (Roku, RN) don't send `Origin` and aren't subject to CORS, so a tight
  allowlist doesn't break them.
- Do not use `origin: true` (reflect-any) on the remote listener.

**Acceptance criteria.**

- Cross-origin `fetch` from an unlisted web origin is blocked by the browser.
- Web SPA and native apps unaffected.

---

## Item 7 - Salt the Whats On User PINs

**File:** `packages/api/src/services/whatsonUsers.ts` (`sha256`, lines ~81-83,
used by `create`/`update`/`verifyPin`).

**Problem.** PINs are hashed with unsalted SHA-256. A 4-digit PIN has 10,000
possibilities - an unsalted fast hash is trivially reversed via a precomputed
table, and identical PINs across profiles produce identical hashes. Low-value,
but `whatsonUsers.json` could travel (backups, support bundles) and the port
could leak the file's contents indirectly.

**Fix.**

- Hash PINs with a slow, salted KDF. The repo already depends on `bcryptjs`
  (used for the admin password in `routes/auth.ts`) - reuse it. Per-PIN salt is
  automatic with bcrypt.
- Migrate on next PIN set/verify: if a stored hash is legacy SHA-256 (64 hex
  chars) and verifies, rehash with bcrypt transparently.

**Acceptance criteria.**

- New/updated PINs are stored as bcrypt hashes.
- Existing SHA-256 PINs still verify and are upgraded on first successful verify.
- `verifyPin` semantics (no PIN set -> allow) unchanged.

---

## Item 8 - Remote stream proxying (prerequisite for remote playback)

**Files:** `services/plex.ts` (~line 750, `streamUrl` build),
`services/embyLike.ts` (~line 926, `master.m3u8` URL), `routes/playback.ts`.

**Problem.** The `streamUrl` returned to clients points **directly at the media
server's address** (e.g. the Plex LAN URL / Jellyfin `cfg.url`). Remotely, the
client can't reach that. If left as-is, remote users would have to forward Plex
*and* Jellyfin *and* Emby ports individually - defeating the "forward one port"
promise.

**Fix.**

- When a request arrives on the remote listener (or carries a remote connection
  hint), rewrite `streamUrl` and segment URLs to route through the Whats On
  backend, which proxies to the media server. There is already a proxying
  precedent in `services/live/hlsProxy.ts` and `routes/live.ts` - follow that
  shape (stream + segment passthrough with the media-server auth attached
  server-side).
- Combine with Item 5: the rewritten URLs are signed, short-lived, and carry no
  device key.
- Preserve the existing direct-URL behavior for LAN requests (lower latency, no
  proxy hop).

**Acceptance criteria.**

- A remote playback session streams video with only port 3002 forwarded.
- LAN playback still uses the direct media-server URL.
- Media-server tokens never appear in URLs handed to the client.

---

## Item 9 - Rate limiting & lockout on the remote listener

**Files:** new middleware; apply on the remote listener; especially auth/pairing
paths.

**Problem.** Exposing pairing, device-code redemption, and server-side PIN entry
to the internet invites brute force (6-digit pair codes, 4-digit PINs, invite
tokens).

**Fix.**

- Per-IP rate limit on the remote listener, tighter on `/auth/*`,
  device-code redeem, and PIN-verify endpoints.
- Lockout / exponential backoff after N failures per code/token.
- Pair codes are already single-active + 10-min TTL (`pairing.ts`), good - but
  the remote-facing device-code flow in doc 02 should use longer, higher-entropy
  codes than the 6-digit LAN code, since it's internet-reachable.

**Acceptance criteria.**

- Rapid wrong-PIN / wrong-code attempts from one IP get throttled/locked.
- Legitimate single-attempt flows are unaffected.

---

## Suggested order

1. **Item 1** (artwork SSRF) - ship standalone, it's a live bug.
2. **Two-listener split** - the structural control everything else leans on.
3. **Items 2, 3, 4** - mandatory auth, roles, profile binding.
4. **Item 8 + Item 5** - remote stream proxy + signed media URLs (together;
   remote playback doesn't work without both).
5. **Items 6, 7, 9** - CORS, PIN KDF, rate limiting.

Items 1, 6, 7 are independent and can land any time. The rest gate the cloud
work in doc 02.
