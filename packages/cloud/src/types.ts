/**
 * Cloud control-plane types.
 *
 * Two groups:
 *  - Stored records (Account, ServerRecord, Invite, DeviceGrant, ClaimCode) —
 *    the cloud's minimal database. It stores NOTHING about media, watch state,
 *    service tokens, or PINs (doc 02 §4.1: "cloud is starved by design").
 *  - Wire types (Candidate, ServerCandidates, GrantPayload, CloudEnvelope,
 *    HeartbeatPayload) — the contract between cloud, backend, and app. These
 *    should be promoted to @whatson/shared when the backend registration
 *    client is built (M4), so all three parties share one source of truth.
 */

// ── Wire contract ─────────────────────────────────────────────────────────

export type CandidateKind = 'lan' | 'wan' | 'ipv6' | 'relay';

export interface Candidate {
  kind: CandidateKind;
  url: string;
  /** Lower = preferred. LAN 0, ipv6 1, wan 2, relay (v2) highest. */
  priority: number;
}

/** Response of GET /api/servers/:id/candidates. */
export interface ServerCandidates {
  serverId: string;
  candidates: Candidate[];
  /** Pinned by the app to detect a wrong-server answer on a foreign LAN. */
  serverId_echo?: string;
  serverCertFingerprint?: string | null;
  ttl: number;
}

export type DeviceRole = 'owner' | 'guest';

/**
 * Claims carried by a cloud-signed grant. Signed with Ed25519 (raw detached
 * signature — NOT a JWT, so there is no `alg` field to confuse; see finding
 * C1). The backend verifies it against the pinned cloud public key, offline.
 */
export interface GrantPayload {
  /** Envelope version. */
  v: 1;
  serverId: string;
  accountId: string;
  /**
   * `owner` (claimed the server → admin device) or `guest` (a member with
   * server access). The unified user model has no per-user binding — which Whats
   * On user you watch as is chosen from the shared picker on the backend.
   */
  role: DeviceRole;
  /** Unique id — the backend records redeemed jti to make grants single-use (H3). */
  jti: string;
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expiry (unix seconds). */
  exp: number;
}

/** Framed, versioned message on the backend<->cloud WSS (doc 02 §3, §10). */
export interface CloudEnvelope<T = unknown> {
  v: 1;
  type: string;
  /** Correlation id for request/ack pairs. */
  id?: string;
  payload?: T;
}

/** Backend heartbeat payload (doc 02 §3). */
export interface HeartbeatPayload {
  serverId: string;
  lanUrls: string[];
  ipv6Url?: string | null;
  wanPortForwarded?: boolean;
  upnpMapped?: boolean;
  /** The backend's internet-facing remote listener port (default 3002). */
  remotePort?: number;
  /** True when the backend holds a valid TLS cert (its :port serves HTTPS). */
  certReady?: boolean;
  appVersion?: string;
  ts: number;
}

/** WSS message type constants — keep the envelope `type` values in one place. */
export const MSG = {
  /** backend → cloud: first frame after connect, proves server identity. */
  HELLO: 'hello',
  /** backend → cloud: periodic reachability/address update. */
  HEARTBEAT: 'heartbeat',
  /** cloud → backend: acknowledge a hello/heartbeat. */
  ACK: 'ack',
  /** cloud → backend: deliver a renewed TLS cert (M8; reserved). */
  CERT: 'cert',
} as const;

// ── Stored records ────────────────────────────────────────────────────────

export interface Account {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface ServerRecord {
  /** serverId = hash of the server public key (Syncthing-style). */
  id: string;
  /** Server public key (PEM), used to verify heartbeat signatures. */
  pubKey: string;
  ownerAccountId: string | null;
  label: string | null;
  /** Owner can disable remote → cloud stops resolving (P2 data-model gap). */
  enabled: boolean;
  revokedAt: string | null;
  lastHeartbeatAt: string | null;
  /** WAN IP the cloud observed the heartbeat connection coming from. */
  observedWanIp: string | null;
  candidates: Candidate[];
  ipv6Url: string | null;
  upnpMapped: boolean;
  appVersion: string | null;
  /** Backend's remote listener port (for building the WAN candidate URL). */
  remotePort?: number | null;
  /** Cloud's external probe result: is the WAN HTTPS port actually reachable? */
  wanReachable?: boolean;
  wanReachableCheckedAt?: string | null;
}

/**
 * An emailed invite to access a server (unified user model). It grants the
 * redeeming cloud account membership of the server — no per-user binding; the
 * person picks/creates their Whats On user from the shared picker on the backend.
 * `provisioningRef` optionally points at a backend-side spec (libraries etc.) the
 * backend applies when the invitee first connects — the cloud never sees it.
 */
export interface Invite {
  token: string;
  serverId: string;
  /** Invited email — prefilled on the accept page + used for the Mailgun send. */
  email: string | null;
  label: string | null;
  role: DeviceRole;
  /** Opaque pointer to a backend provisioning spec; the cloud stores it blindly. */
  provisioningRef: string | null;
  expiresAt: number;
  redeemedByAccountId: string | null;
  redeemedAt: string | null;
}

/**
 * A cloud account's standing membership of a server (unified user model). Created
 * when the account redeems an invite. It's what lets them self-service approve
 * their OWN devices via the device-code flow (no owner approval per device). Pure
 * access — no profile/binding; identity is the backend's shared picker.
 */
export interface ServerMembership {
  id: string;
  accountId: string;
  serverId: string;
  role: DeviceRole;
  createdAt: string;
  revokedAt: string | null;
}

export interface DeviceGrant {
  id: string;
  serverId: string;
  accountId: string;
  role: DeviceRole;
  /**
   * App-facing bearer token for ongoing cloud calls (candidate refresh after a
   * WAN-IP change). Addresses the P1 finding that the data model had no way to
   * authenticate the app's continued cloud access post-redeem.
   */
  cloudToken: string;
  createdAt: string;
  revokedAt: string | null;
}

/** Short-lived pending server claim (owner enters this in the cloud UI). */
export interface ClaimCode {
  code: string;
  serverId: string;
  expiresAt: number;
}
