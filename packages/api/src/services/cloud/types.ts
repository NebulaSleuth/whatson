/**
 * Wire contract with the cloud control plane. These MUST stay byte-compatible
 * with `packages/cloud/src/types.ts` (same JSON field names + the same
 * base64url(json).base64url(sig) grant encoding).
 *
 * TODO: promote this shared contract to `@whatson/shared` so the backend, the
 * cloud, and (later) the app all import one definition instead of mirroring it.
 */

export type DeviceRole = 'owner' | 'guest';

/** Claims carried by a cloud-signed grant (raw Ed25519 detached signature). */
export interface GrantPayload {
  v: 1;
  serverId: string;
  accountId: string;
  role: DeviceRole;
  boundWoProfileId: string | null;
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
  appVersion?: string;
  ts: number;
}

export const MSG = {
  HELLO: 'hello',
  HEARTBEAT: 'heartbeat',
  ACK: 'ack',
  CERT: 'cert',
} as const;
