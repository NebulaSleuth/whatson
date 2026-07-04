import { WebSocket } from 'ws';
import { networkInterfaces } from 'node:os';
import { APP_VERSION } from '@whatson/shared';
import { config } from '../../config.js';
import { getServerId, getPublicKeyPem, signMessage } from './identity.js';
import { MSG, type CloudEnvelope, type HeartbeatPayload } from './types.js';

/**
 * Persistent outbound control channel to the cloud (doc 02 §3). Opens a WSS,
 * proves identity with a signed `hello`, then heartbeats reachable addresses so
 * the cloud can build the candidate list. Outbound-only so it works behind
 * CGNAT; reconnects with backoff. Control-plane only — no video (doc 03).
 *
 * Dormant unless remote access is enabled AND a cloud URL is configured, so the
 * fleet is unaffected until an owner turns remote on.
 */

const HEARTBEAT_MS = 45_000;
const MAX_BACKOFF_MS = 60_000;

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let backoff = 1_000;
let stopped = true;

/** LAN IPv4 base URLs (one per non-internal NIC) for the candidate list. */
function lanUrls(): string[] {
  const urls: string[] = [];
  const ifaces = networkInterfaces();
  for (const infos of Object.values(ifaces)) {
    for (const ni of infos ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${config.port}`);
    }
  }
  return urls;
}

/**
 * Best-effort global IPv6 URL. Skips link-local (fe80::/10) and ULA (fc00::/7).
 * NOTE: on Windows this can pick a temporary/privacy address that rotates daily
 * — M8 replaces this with `netsh` Public/Preferred selection + an external probe.
 */
function ipv6Url(): string | null {
  const ifaces = networkInterfaces();
  for (const infos of Object.values(ifaces)) {
    for (const ni of infos ?? []) {
      if (ni.family !== 'IPv6' || ni.internal) continue;
      const a = ni.address.toLowerCase();
      if (a.startsWith('fe80') || a.startsWith('fc') || a.startsWith('fd') || a === '::1') continue;
      return `https://[${ni.address}]:${config.remote.port}`;
    }
  }
  return null;
}

function buildHeartbeat(): HeartbeatPayload {
  return {
    serverId: getServerId(),
    lanUrls: lanUrls(),
    ipv6Url: ipv6Url(),
    // UPnP / port-forward detection is M8; report unknown-as-false for now.
    wanPortForwarded: false,
    upnpMapped: false,
    appVersion: APP_VERSION,
    ts: Date.now(),
  };
}

function send(env: CloudEnvelope): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(env));
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  send({ v: 1, type: MSG.HEARTBEAT, payload: buildHeartbeat() });
  heartbeatTimer = setInterval(() => send({ v: 1, type: MSG.HEARTBEAT, payload: buildHeartbeat() }), HEARTBEAT_MS);
}

/**
 * Register the server's public key with the cloud (idempotent upsert) so the
 * WSS `hello` can be verified against it. Proven by signing with the server key.
 */
async function registerWithCloud(): Promise<boolean> {
  const serverId = getServerId();
  try {
    const res = await fetch(`${config.cloud.url}/api/servers/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pubKey: getPublicKeyPem(), sig: signMessage(`register:${serverId}`) }),
    });
    if (!res.ok) {
      console.warn(`[cloud] server registration failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[cloud] server registration error: ${(err as Error).message}`);
    return false;
  }
}

async function bootstrap(): Promise<void> {
  if (stopped) return;
  if (!(await registerWithCloud())) {
    scheduleReconnect();
    return;
  }
  connect();
}

function scheduleReconnect(): void {
  if (stopped) return;
  setTimeout(() => void bootstrap(), backoff);
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
}

function connect(): void {
  if (stopped) return;
  const wsUrl = `${config.cloud.url.replace(/^http/, 'ws')}/ws`;
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    const serverId = getServerId();
    send({ v: 1, type: MSG.HELLO, payload: { serverId, sig: signMessage(`hello:${serverId}`) } });
  });

  ws.on('message', (raw) => {
    let env: CloudEnvelope;
    try {
      env = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (env.type !== MSG.ACK) return;
    const ok = (env.payload as { ok?: boolean } | undefined)?.ok === true;
    if (ok && !heartbeatTimer) {
      backoff = 1_000; // successful hello → reset backoff
      startHeartbeat();
    } else if (!ok && !heartbeatTimer) {
      console.warn('[cloud] hello rejected by cloud:', (env.payload as { error?: string })?.error);
      ws?.close();
    }
  });

  ws.on('close', () => {
    stopHeartbeat();
    scheduleReconnect();
  });

  ws.on('error', () => {
    // 'close' fires next and handles reconnect.
  });
}

export function startCloudRegistration(): void {
  if (!config.remote.enabled || !config.cloud.url) return;
  stopped = false;
  backoff = 1_000;
  console.log(`[cloud] registering serverId=${getServerId()} with ${config.cloud.url}`);
  void bootstrap();
}

export function stopCloudRegistration(): void {
  stopped = true;
  stopHeartbeat();
  ws?.close();
  ws = null;
}
