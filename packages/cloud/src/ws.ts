import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import * as store from './store.js';
import { config } from './config.js';
import { verifyServerSignature } from './crypto.js';
import { publishServerDns } from './dns.js';
import { MSG, type CloudEnvelope, type HeartbeatPayload, type Candidate } from './types.js';

/**
 * Backend <-> cloud control channel (doc 02 §3). The backend holds a persistent
 * outbound WSS; the cloud records the source IP as the observed WAN IP and
 * turns heartbeats into the candidate list apps resolve.
 *
 * Every message is a framed, versioned envelope { v, type, id?, payload } so v2
 * can add relay-open/relay-data stream types without a protocol break (doc 03).
 * The control channel stays control-only — video never rides this socket.
 */

interface Conn {
  ws: WebSocket;
  serverId: string | null;
  wanIp: string | null;
}

function send(ws: WebSocket, env: CloudEnvelope): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(env));
}

function normalizeIp(raw: string | undefined): string | null {
  if (!raw) return null;
  // Strip IPv4-mapped IPv6 prefix so A-record candidates read cleanly.
  return raw.replace(/^::ffff:/, '');
}

/** Strip a trailing `:port` from an address, handling bracketed IPv6. */
function stripPort(addr: string): string {
  const bracketed = addr.match(/^\[([^\]]+)\](?::\d+)?$/); // [::1] or [::1]:1234
  if (bracketed) return bracketed[1];
  // IPv4 with port: exactly one colon and a dotted quad before it.
  if (addr.includes('.') && addr.split(':').length === 2) return addr.split(':')[0];
  return addr; // bare IPv4 or bare IPv6
}

/**
 * The client's real public IP. App Service (and any reverse proxy) terminates
 * the socket, so `req.socket.remoteAddress` is an internal LB address
 * (169.254.x.x) — the true client IP is the first entry of X-Forwarded-For.
 * Falls back to the socket address for a direct (no-proxy) connection.
 */
function clientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string | null {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (raw) {
    const first = raw.split(',')[0].trim();
    if (first) return normalizeIp(stripPort(first));
  }
  return normalizeIp(req.socket.remoteAddress);
}

/** Build the candidate list from a heartbeat + the cloud-observed WAN IP. */
function buildCandidates(hb: HeartbeatPayload, serverId: string): Candidate[] {
  const host = `${serverId}.s.${config.cloudDomain}`;
  const candidates: Candidate[] = [];
  for (const url of hb.lanUrls ?? []) candidates.push({ kind: 'lan', url, priority: 0 });
  if (hb.ipv6Url) candidates.push({ kind: 'ipv6', url: `https://${host}`, priority: 1 });
  if (hb.wanPortForwarded) candidates.push({ kind: 'wan', url: `https://${host}:3002`, priority: 2 });
  return candidates;
}

export function initCloudWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const conn: Conn = { ws, serverId: null, wanIp: clientIp(req) };

    ws.on('message', (raw) => {
      let env: CloudEnvelope;
      try {
        env = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (env.v !== 1 || typeof env.type !== 'string') return;

      switch (env.type) {
        case MSG.HELLO: {
          // { serverId, sig } — sig proves possession of the server key.
          const p = env.payload as { serverId?: string; sig?: string } | undefined;
          const s = p?.serverId ? store.getServer(p.serverId) : null;
          if (!s || !p?.sig || !verifyServerSignature(s.pubKey, `hello:${s.id}`, p.sig)) {
            send(ws, { v: 1, type: MSG.ACK, id: env.id, payload: { ok: false, error: 'unauthenticated' } });
            ws.close();
            return;
          }
          conn.serverId = s.id;
          send(ws, { v: 1, type: MSG.ACK, id: env.id, payload: { ok: true, serverId: s.id } });
          break;
        }
        case MSG.HEARTBEAT: {
          if (!conn.serverId) {
            send(ws, { v: 1, type: MSG.ACK, id: env.id, payload: { ok: false, error: 'say hello first' } });
            return;
          }
          const hb = env.payload as HeartbeatPayload;
          store.updateServerHeartbeat(conn.serverId, {
            candidates: buildCandidates(hb, conn.serverId),
            observedWanIp: conn.wanIp,
            ipv6Url: hb.ipv6Url ?? null,
            upnpMapped: !!hb.upnpMapped,
            appVersion: hb.appVersion ?? null,
          });
          // M8: publish <serverId>.s.whatsontv.net -> WAN IPv4 (+ IPv6 if any) so
          // apps can reach the backend by a cert-matching hostname. Fire-and-
          // forget; no-op unless DNS publishing is configured (App Service MSI).
          void publishServerDns(conn.serverId, conn.wanIp, hb.ipv6Url ?? null);
          send(ws, { v: 1, type: MSG.ACK, id: env.id, payload: { ok: true } });
          break;
        }
        default:
          // Unknown types are ignored (forward-compatible with v2 stream types).
          break;
      }
    });
  });

  console.log('[cloud] WebSocket registration endpoint ready on /ws');
}
