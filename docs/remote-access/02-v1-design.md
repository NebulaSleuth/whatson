# 02 - v1 Design: Cloud Discovery + Direct Connections

**Status:** v1. Depends on the hardening in [`01-security-hardening.md`](01-security-hardening.md).

**Scope:** a small cloud service that lets an app *find* a user's backend from
anywhere, plus the backend and client changes to establish a **direct**
connection (no relay). Video never touches the cloud in v1.

---

## 1. The model in one picture

```
                    +------------------------------+
                    |   Whats On Cloud Service      |
                    |  (accounts, invites,          |
                    |   server registry, probe)     |
                    +------------------------------+
                     ^          ^              ^
       register +    |          | resolve      | device-code /
       heartbeat     |          | candidates   | invite redeem
       (outbound     |          |              |
        WSS/HTTPS)   |          |              |
                     |          |              |
        +------------+---+   +--+----------+   |
        |  Whats On       |   |  App        |<-+
        |  Backend        |   | (Roku/RN/   |
        |  :3001 LAN      |   |  web/tvOS)  |
        |  :3002 remote   |<--+             |
        +-----------------+   +-------------+
             ^   direct HTTPS (LAN / WAN / IPv6),
             |   candidates raced + cached on device
             +-- NO cloud in the data path
```

The cloud is a **rendezvous + address book + reachability oracle**. Once the app
has a candidate address and a signed grant, it talks straight to the backend.
This is the Plex architecture, minus Plex's offline weakness (we cache
candidates on-device) and minus any relay (deferred to v2).

Proven prior art for this exact shape: Syncthing (global discovery server maps
device-id -> current addresses; relays are separate and optional) and Plex
(connection candidates raced by the client, direct preferred).

---

## 2. Connection candidates & racing (the heart of it)

A backend is reachable by zero or more of:

- **LAN URLs** - `http://192.168.x.y:3001` (and any additional NICs). Used when
  the app is on the same network. Plain HTTP is fine here; it never leaves the
  LAN.
- **WAN URL** - `https://<id>.s.<clouddomain>:3002`, resolving to the home's
  public IPv4, reachable because the user forwarded 3002 (or UPnP did). TLS.
- **IPv6 URL** - `https://<id>.s.<clouddomain>` on the backend's global IPv6
  address with a firewall pinhole. **This is the CGNAT rescue** - CGNAT ISPs
  almost always hand out working IPv6, and a remote phone on cellular usually has
  IPv6 too. No NAT, no relay.

### Candidate list

The cloud stores, per server, the current set of candidate URLs (reported by the
backend heartbeat, plus the WAN IP the cloud observed the heartbeat coming
from). An authenticated app calls:

```
GET  {cloud}/api/servers/{serverId}/candidates
     -> { candidates: [
           { kind: 'lan',  url: 'http://192.168.1.50:3001', priority: 0 },
           { kind: 'ipv6', url: 'https://<id>.s.dom',        priority: 1 },
           { kind: 'wan',  url: 'https://<id>.s.dom:3002',   priority: 2 }
         ],
         serverCertFingerprint: '...', ttl: 300 }
```

### Racing algorithm (client)

1. On launch / network change, load the **cached** candidate list from device
   storage first (works with no internet).
2. In parallel, refresh the list from the cloud (best-effort; ignore failure).
3. Race all candidates with a short per-candidate timeout (~1-2s): issue
   `GET /api/health` (public path) to each. Prefer the lowest-priority (LAN)
   that answers. Pin the winner for the session.
4. Persist the winning candidate and the full list to device storage.
5. On a request failure mid-session, re-race.

This generalizes the app's existing `plexConnectionType: 'local' | 'remote'`
logic (`lib/store.ts`, sent as `X-Plex-Connection`). Keep sending that header -
the backend uses it for Plex link selection and (per doc 01, Item 8) for
deciding whether to hand back direct vs proxied stream URLs.

### Why caching matters

If the internet is down but the phone is home, step 1 supplies the LAN candidate
and step 3 finds it. The app works. This is the explicit fix for the Plex
offline flaw called out in the design discussion.

---

## 3. Backend: registration & heartbeat

New backend module (e.g. `services/cloud/registration.ts`). Only active when the
owner has enabled remote access and claimed the server (see section 4).

Responsibilities:

- **Identity.** Generate a server keypair on first enable. `serverId` =
  hash of the public key (Syncthing-style). Persist alongside
  `paired-devices.json`. The public key is what the cloud stores and what signs
  the server's heartbeats; the private key never leaves the backend.
- **Persistent outbound connection.** Open an outbound WSS to the cloud and keep
  it alive (reconnect w/ backoff). Outbound works behind CGNAT and needs no
  router config. This connection carries: heartbeats, candidate updates, and
  (v2) would carry relay muxing. In v1 it's control-plane only.
- **Heartbeat payload.** Every ~30-60s (and on network change), send:
  `{ serverId, lanUrls[], ipv6Url?, wanPortForwarded?: bool, upnpMapped?: bool,
     appVersion, ts }`, signed by the server key. The cloud records the source IP
  of the connection as the observed WAN IP.
- **UPnP / NAT-PMP attempt.** On enable, try to map port 3002 via UPnP/NAT-PMP
  (as Plex does). Report success/failure in the heartbeat so the cloud and the
  `/setup` UI can show reachability state.
- **Local NIC enumeration.** Collect LAN IPv4s and the global IPv6, build the
  `lanUrls` / `ipv6Url` candidates.

The backend must **degrade gracefully**: if the cloud is unreachable, the LAN
listener keeps serving. Remote is a bonus layer, never a dependency.

---

## 4. Cloud service: accounts, claim, invites, device-code

A small stateless-ish API + a database. Recommended to run the **control plane**
on the user's existing Azure (it's tiny - pennies), keeping v2 relay egress on
cheap-bandwidth hosts (doc 03). Nothing here handles video.

### 4.1 Data model (minimal - store nothing you don't need)

```
Account        { id, email, passwordHash, createdAt }
Server         { id (=pubKeyHash), pubKey, ownerAccountId, label,
                 lastHeartbeatAt, observedWanIp, candidates[], upnpMapped }
Invite         { token, serverId, boundWoProfileId?, label?, role:'guest',
                 expiresAt, redeemedByAccountId?, redeemedAt? }
DeviceGrant    { id, serverId, accountId, role, boundWoProfileId?,
                 createdAt, revokedAt? }
```

Explicitly **not** stored: media titles, watch history, service tokens, PINs,
stream data. The cloud is untrusted infra that only helps two authenticated
parties rendezvous.

### 4.2 Owner onboarding (claim)

1. Owner creates a cloud account (email + password), or signs in.
2. In `/setup`, owner enables remote access. Backend generates its keypair and
   shows a **claim code** (or a QR) while the admin is on the LAN.
3. Owner, signed into the cloud, enters the claim code -> cloud binds
   `Server.ownerAccountId`. The backend learns the cloud's **public key** during
   this exchange and persists it - this is what lets the backend verify
   cloud-signed grants offline (no per-request cloud call).
4. Backend opens its persistent WSS and starts heartbeating.

### 4.3 Invites (guests)

- Owner, in the app or cloud UI, creates an invite: optional bound WO profile,
  optional label, expiry. Cloud returns a redeemable token (shown as a link +
  QR).
- Guest redeems via the app: enters/scan token -> cloud validates, creates a
  `DeviceGrant` (role `guest`, bound to the profile if set), and returns the
  server's candidates + a **signed grant** (see section 5).
- The guest's app then pairs with the backend using the grant (section 6) and
  receives a device auth key bound to that one WO profile (doc 01, Item 4).

### 4.4 Device-code linking (no invite / owner's own new device)

For a TV where typing is painful - RFC 8628 device authorization, the pattern
plex.tv/link uses:

1. App shows a code + QR ("go to `cloud/link`, enter `WXYZ-1234`").
2. App polls the cloud for completion.
3. Owner opens the link on a phone/laptop, signs in, enters the code, picks which
   server (and, for a guest, which profile).
4. Cloud marks the code complete; app's next poll returns candidates + signed
   grant.

Use longer, higher-entropy codes than the LAN 6-digit pair code - this endpoint
is internet-reachable. Rate-limit hard (doc 01, Item 9).

### 4.5 Reachability probe (diagnostics)

The cloud probes the server's claimed WAN candidate from **outside**:

- Connects to `https://<observedWanIp>:3002/api/health`.
- Cross-checks against the backend's self-reported `upnpMapped` / port-forward
  state.
- The mismatch **"backend thinks the port is mapped, but the outside probe
  fails"** is the **CGNAT signature**. Surface it in `/setup` as a Plex-style
  panel:
  - OK - Direct (IPv4) reachable
  - OK - IPv6 reachable
  - FAIL - IPv4 blocked: *likely CGNAT; here's what that means and that IPv6 (if
    your remote device supports it) will still work; relay is coming in a future
    update.*

Clear failure diagnosis is the product answer to CGNAT in v1. Don't leave the
user debugging a port-forward that can never work.

---

## 5. Trust: cloud-signed grants, backend-verified offline

The crucial property: **the cloud vouches for who a device is, but the backend
verifies that vouching without calling the cloud per request.** This keeps the
remote path alive when the cloud is down and keeps the cloud out of the data
path.

- On claim (4.2), the backend stores the cloud's **public key**.
- When a guest/device redeems (4.3/4.4), the cloud issues a **signed grant**
  (JWT or equivalent) carrying:
  `{ serverId, accountId, role: 'owner'|'guest', boundWoProfileId?, exp }`,
  signed by the cloud's private key.
- The app presents this grant to the **backend** once, during pairing (section
  6). The backend verifies the signature against the stored cloud public key,
  checks `serverId` matches itself and `exp` is valid, then provisions a local
  device record + auth key (reusing `services/pairing.ts`) with the role and
  bound profile from the grant.
- After that, the app authenticates to the backend with the **device auth key**
  (`X-Whatson-Auth`) exactly like a LAN-paired device. The cloud is not involved
  in any subsequent request.

This means a compromised or offline cloud cannot read or relay user data - worst
case it can't mint *new* grants. Existing devices keep working.

---

## 6. Pairing over the remote listener

Extend `services/pairing.ts` / `routes/auth.ts` with a grant-based path
alongside the existing LAN code path:

```
POST {backend:3002}/api/auth/redeem-grant   { grant: <signed JWT> }
  -> backend verifies grant against stored cloud pubkey
  -> creates PairedDevice { role, boundWoProfileId } via pairing.ts
  -> returns { key }  (the device auth key, one-shot, as today)
```

From then on the device uses `X-Whatson-Auth` (header) or signed URLs (media,
doc 01 Item 5). The existing 6-digit LAN pairing flow stays for same-network
onboarding.

---

## 7. TLS & the per-server hostname

The remote listener needs a real cert (Roku is unhappy with self-signed; browsers
reject it). Use the Plex `*.plex.direct` trick, which is cheap once the cloud
owns a DNS zone:

- Cloud controls a zone, e.g. `s.<clouddomain>`.
- Each server gets `<serverId>.s.<clouddomain>`. The cloud publishes A/AAAA
  records pointing at the server's observed WAN IPv4 and global IPv6.
- Cert issued via **Let's Encrypt DNS-01** (the cloud answers the DNS challenge,
  so no inbound port 80 needed on the home). The cert is delivered to the backend
  over its persistent WSS connection and installed on the 3002 listener.
- Renew centrally; push renewed certs down the WSS.

Until this exists, the remote listener can be gated behind a user-provided
reverse proxy that already terminates TLS, but the shipping default is the
managed per-server cert. The LAN listener stays plain HTTP (offline-safe).

---

## 8. Client (app) changes

- **Connection manager** (`lib/`): candidate racing + caching (section 2).
  Replaces the current single-`apiUrl` assumption in `lib/store.ts` with a
  prioritized candidate list; expose the winning base URL to `lib/api.ts`.
- **Pairing UI:** two entry points - enter/scan an invite or device-code (remote
  onboarding, 4.3/4.4), or the existing LAN pair-code flow. On success, store
  the device auth key (already the pattern) + the candidate list.
- **Offline behavior:** if only the LAN candidate answers, operate normally; if
  none answer, show a clear "can't reach your server" state (not a spinner).
- **Roku:** same flows expressed as HTTPS + `?auth=`/signed URLs. No new
  transport. Verify against `apps/roku/PLAN.md` parity commitments.

`lib/api.ts` already sends `X-Plex-User`/`X-Whatson-User` and
`X-Plex-Connection`; add `X-Whatson-Auth` (already used by paired devices) and
switch media/segment/poster URLs to signed URLs when talking to the remote
listener.

---

## 9. Build order (v1)

1. Doc 01 hardening (blocks everything).
2. Backend: server identity + persistent WSS + heartbeat + UPnP attempt + NIC
   enumeration (section 3). Testable against a stub cloud.
3. Cloud service: accounts, claim, server registry, candidates endpoint,
   reachability probe (section 4). Deploy control plane on Azure.
4. Grants + remote pairing (section 5, 6). End-to-end: redeem -> pair ->
   authenticated request on 3002.
5. Invites + device-code UI (4.3/4.4) in app + cloud.
6. Client connection manager: candidate racing + caching (section 2, 8).
7. DNS + per-server certs (section 7).
8. Remote stream proxying + signed media URLs (doc 01 Items 8 & 5) - required
   before remote *playback* is usable, though browse works earlier.

Browse-remotely can demo after step 6 (over a user-provided TLS proxy);
play-remotely needs step 8.

---

## 10. Open decisions (settle before coding the relevant part)

- **Cloud domain / DNS zone.** Pick early - section 7 depends on it, and the
  app's CORS allowlist (doc 01 Item 6) references `<id>.s.<clouddomain>`.
- **Does LAN stay unauthenticated when remote is off?** Recommendation: **yes** -
  zero behavior change unless the owner enables/claims remote, mirroring how the
  Whats On Users feature is off-by-default. Enabling remote should *prompt* to set
  an admin password (it becomes mandatory for the remote listener per doc 01
  Item 2).
- **Account system ownership.** The cloud account is new and separate from
  everything in-app today. Confirm email+password is acceptable, or whether to
  federate (Plex OAuth is already wired for user PIN flow and could seed
  identity).
- **Invite -> profile auto-create.** Should redeeming an invite that names a new
  guest auto-create a matching WO profile on the backend, or require the owner to
  pre-create it? Auto-create is friendlier; pre-create is simpler and keeps
  profile management in one place (`/setup`).
