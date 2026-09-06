# @whatson/cloud — remote-access control plane

The small cloud service from `docs/remote-access/02-v1-design.md`. It is a
**rendezvous + address book + reachability oracle** — it lets an app *find* a
user's backend from anywhere and vouches for who a device is, then gets out of
the way. **No media, watch state, service tokens, PINs, or streams ever touch
it** ("the cloud is starved by design"). Video never transits the cloud in v1.

**Status (2026-09): shipped and deployed.** The service is live on Azure at
`cloud.whatsontv.net`, wired to the backend (M4 registration client in
`packages/api/src/services/cloud/registration.ts`), with the M8 ACME DNS-01 per-server
TLS flow implemented (`certManager.ts` + `POST /api/servers/:id/acme-challenge`). The
M7 guest-**binding** semantics originally planned here were superseded by the unified
user model (`docs/user-model/`) — invites now just grant server access.

## What runs today

```
HTTP + WSS (one port, default 4000)

  GET  /api/health                      liveness
  GET  /api/cloud-key                   the Ed25519 public key to PIN in the app build

  POST /api/accounts                    register (email + password)  -> session token
  POST /api/accounts/login              -> session token
  GET  /api/accounts/me                 account + owned servers

  POST /api/servers/register            backend proves key possession -> serverId
  POST /api/servers/:id/claim-code      backend requests a LAN-shown claim code
  POST /api/servers/claim               owner binds the server (session + code)
  GET  /api/servers/:id/candidates      owner session OR a grant's cloudToken
  POST /api/servers/:id/grant           owner mints a grant for their own device
  GET  /api/servers/:id/reachability    external probe (CGNAT diagnosis)
  PATCH /api/servers/:id                enable/disable, rename

  POST /api/servers/:id/invites         owner mints an invite (server access)
  GET  /api/invites/:token              public invite lookup
  POST /api/invites/redeem              invitee redeems -> grant + candidates
  POST /api/servers/:id/acme-challenge  backend sets a DNS-01 TXT record (M8 certs)
  POST /api/servers/:id/acme-challenge/clear
  POST /api/device-code                 RFC 8628 device-code start
  POST /api/device-code/approve         owner approves a user code
  POST /api/device-code/poll            app polls for the grant

  WS   /ws                              backend registration channel (hello + heartbeat)
```

The WSS uses a **framed, versioned envelope** `{ v, type, id?, payload }` so v2's
relay muxing can add stream types without a protocol break, and it stays
control-only (doc 03).

## Security decisions baked in (from the design review)

- **Grants are raw Ed25519 detached signatures, not JWTs** (`crypto.ts`). There
  is no `alg` field to confuse, so the JWT algorithm-confusion class (finding
  **C1**) is structurally impossible — verification only ever uses Ed25519 + the
  cloud key.
- **The cloud never holds a server's TLS key.** Servers prove identity by
  *signing* with their own key; the cloud only stores public keys (finding H1 is
  a backend/cert concern, but the trust direction is set here).
- **The cloud public key is pinned, not TOFU'd.** `GET /api/cloud-key` exists so
  the app build can pin it; the backend must not trust a key pushed over an
  unauthenticated channel (finding M5).
- **Grants carry a `jti`** so the backend can enforce single-use redemption
  (finding H3 — backend side, M4).
- **`DeviceGrant` has an app-facing `cloudToken`** for candidate refresh after a
  WAN-IP change (the P1 data-model gap the review flagged).
- **`ServerRecord.enabled` / `revokedAt`** let an owner disable remote and have
  the cloud stop resolving immediately (P2 gap).

## Run it

```bash
cp packages/cloud/.env.example packages/cloud/.env   # optional; env can be set directly
npm run dev -w packages/cloud                         # tsx watch, :4000
# or
PORT=4111 CLOUD_DATA_DIR=./data npx tsx packages/cloud/src/index.ts
```

State persists to `CLOUD_DATA_DIR/cloud-db.json`; the signing key to
`cloud-ed25519.pem` (keep it — losing it invalidates every issued grant).

## Decisions (settled)

- **Cloud DNS zone / domain** (`CLOUD_DOMAIN`) — ✅ **`whatsontv.net`**, registered,
  with the `s.whatsontv.net` zone delegated to Azure DNS for per-server hostnames
  (`<serverId>.s.whatsontv.net`, mirroring `plex.direct`) and the M8 DNS-01 cert flow.
  See `docs/remote-access/STATUS.md` for the verified setup.
- **Account model** — email + password. (Plex OAuth federation remains a possible future.)
- **Invite → profile** — settled by the unified user model: invites grant *server
  access*; profiles are managed on the backend ("Who's Watching?" picker). The old
  auto-create-vs-pre-create question is moot. A `provisioningRef` is forwarded to the
  cloud for the future self-create flow (`docs/user-model/02-remaining.md` #3 — not
  yet consumed by anything).

## Done since the scaffold

1. ✅ **M4** — backend registration client (`packages/api/src/services/cloud/registration.ts`):
   server keypair, persistent outbound WSS + heartbeat, `POST /api/auth/redeem-grant`
   verifying against the pinned cloud key, single-use by `jti`, provisioning via `pairing.ts`.
2. ✅ **Cert flow (M8)** — per-server DNS-01 via `certManager.ts` + `acme.ts` and the
   `/acme-challenge` endpoints above.
3. ✅ **Deployed** — Azure, long-lived WSS (not Functions).

## Remaining hardening (still open)

- **Promote the wire types** (`Candidate`, `ServerCandidates`, `GrantPayload`,
  `CloudEnvelope`, `HeartbeatPayload`) from `src/types.ts` into `@whatson/shared`.
- **Swap the JSON store** for Azure Table Storage / Postgres (`store.ts` is the
  only file that changes).
- **Rate limiting** on `/accounts/login`, `/servers/claim`, `/invites/redeem`,
  and device-code poll/approve — per-credential, not per-IP (finding M1).
