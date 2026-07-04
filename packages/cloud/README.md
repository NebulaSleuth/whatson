# @whatson/cloud — remote-access control plane

The small cloud service from `docs/remote-access/02-v1-design.md`. It is a
**rendezvous + address book + reachability oracle** — it lets an app *find* a
user's backend from anywhere and vouches for who a device is, then gets out of
the way. **No media, watch state, service tokens, PINs, or streams ever touch
it** ("the cloud is starved by design"). Video never transits the cloud in v1.

This is the **M3 scaffold**: the service runs end to end (register → claim →
heartbeat → candidates → grant), typechecks, and has the security findings from
the review baked in. It is not yet wired to the backend (that's M4) or deployed.

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

  POST /api/invites                     owner mints a guest invite            (M7 groundwork)
  POST /api/invites/redeem              guest redeems -> grant + candidates    (M7 groundwork)
  POST /api/device-code                 RFC 8628 device-code start             (M7 groundwork)
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

## Open decisions (doc 02 §10 — settle before the dependent milestone)

- **Cloud DNS zone / domain** (`CLOUD_DOMAIN`) — currently the placeholder
  `s.whatson.example`. Needed for the per-server hostname + cert flow (M8) and
  referenced by the app CORS allowlist. **Pick this early.**
- **Account model** — email + password today. Could federate Plex OAuth (already
  wired for the PIN flow) instead.
- **Invite → profile** — redeem currently assumes the WO profile already exists
  on the backend. Decide auto-create vs pre-create for M7.

## Next steps

1. **M4** — backend registration client (`packages/api`): generate the server
   keypair, hold the persistent outbound WSS, heartbeat, and the
   `POST /api/auth/redeem-grant` path that verifies a grant against the pinned
   cloud key and provisions a device via `pairing.ts` (single-use by `jti`).
2. **Promote the wire types** (`Candidate`, `ServerCandidates`, `GrantPayload`,
   `CloudEnvelope`, `HeartbeatPayload`) from `src/types.ts` into `@whatson/shared`
   so the backend and cloud share one contract.
3. **Swap the JSON store** for Azure Table Storage / Postgres (`store.ts` is the
   only file that changes).
4. **Rate limiting** on `/accounts/login`, `/servers/claim`, `/invites/redeem`,
   and device-code poll/approve — per-credential, not per-IP (finding M1).
5. **Cert flow (M8)** — DNS-01 per-server or a wildcard shortcut; `serverCert
   Fingerprint` in the candidates response is stubbed `null` until then.
6. **Deploy** on Azure App Service or a small container (**not** Functions — the
   WSS needs a long-lived socket).
