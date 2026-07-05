/**
 * Wire contract with the cloud control plane. These MUST stay byte-compatible
 * with `packages/cloud/src/types.ts` (same JSON field names + the same
 * base64url(json).base64url(sig) grant encoding).
 *
 * TODO: promote this shared contract to `@whatson/shared` so the backend, the
 * cloud, and (later) the app all import one definition instead of mirroring it.
 */

export type DeviceRole = 'owner' | 'guest';

/**
 * How a guest's in-app profile is determined (M7). MUST match
 * `packages/cloud/src/types.ts` InviteBinding.
 *  - `locked`     — bound to `boundWoProfileId`.
 *  - `locked-new` — guest creates a Whats On user in-app, then is locked to it.
 *  - `open`       — guest isn't locked; picks any Whats On user each session.
 */
export type GuestBinding = 'locked' | 'locked-new' | 'open';

/** Claims carried by a cloud-signed grant (raw Ed25519 detached signature). */
export interface GrantPayload {
  v: 1;
  serverId: string;
  accountId: string;
  role: DeviceRole;
  boundWoProfileId: string | null;
  /** Guest access shape (M7). Absent on owner grants + pre-M7 guest grants
   *  (which are treated as `'locked'` for back-compat). */
  guestBinding?: GuestBinding;
  /** Admin-suggested name to prefill the in-app new-viewer form (`locked-new`). */
  newUserName?: string | null;
  jti: string;
  iat: number;
  exp: number;
}

/** Framed, versioned message on the backend<->cloud WSS. */
export interface CloudEnvelope<T = unknown> {
  v: 1;
  type: string;
  id?: string;
  payload?: T;
}

/** Backend heartbeat payload sent to the cloud. */
export interface HeartbeatPayload {
  serverId: string;
  lanUrls: string[];
  ipv6Url?: string | null;
  wanPortForwarded?: boolean;
  upnpMapped?: boolean;
  /** Internet-facing remote listener port (default 3002). */
  remotePort?: number;
  /** True when a valid TLS cert is held (the remote listener serves HTTPS). */
  certReady?: boolean;
  appVersion?: string;
  ts: number;
}

export const MSG = {
  HELLO: 'hello',
  HEARTBEAT: 'heartbeat',
  ACK: 'ack',
  CERT: 'cert',
} as const;
