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
  role: DeviceRole;
  boundWoProfileId: string | null;
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
}

export interface Invite {
  token: string;
  serverId: string;
  boundWoProfileId: string | null;
  label: string | null;
  role: 'guest';
  expiresAt: number;
  redeemedByAccountId: string | null;
  redeemedAt: string | null;
}

export interface DeviceGrant {
  id: string;
  serverId: string;
  accountId: string;
  role: DeviceRole;
  boundWoProfileId: string | null;
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
