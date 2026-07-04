import { createServer, type Server } from 'http';
import express from 'express';
import { config } from '../config.js';
import { corsMiddleware } from '../security/httpGuards.js';
import { mountApiRoutes, makeErrorHandler } from './surface.js';

/**
 * The internet-facing "remote" listener (docs/remote-access/, M1) as a
 * start/stop-able module so the /setup Remote Access panel can toggle it at
 * runtime — no process restart. index.ts calls startRemoteListener() at boot
 * with identical guards, so boot behaviour is unchanged.
 *
 * It is consumer-routes-only (no admin routers, no WebSocket) and REFUSES TO
 * START without an admin password, so it can never run open. Off by default
 * (REMOTE_ACCESS!=true) — the fleet is byte-for-byte unchanged until an owner
 * turns it on.
 */

let remoteServer: Server | null = null;

/** True when the remote listener is currently bound. */
export function isRemoteListenerRunning(): boolean {
  return remoteServer !== null;
}

/**
 * Start the remote listener if enabled and its prerequisites are met. Idempotent
 * — a no-op when already running or when disabled. Returns why it did/didn't
 * start so callers (the panel endpoint) can surface it.
 */
export function startRemoteListener(): { started: boolean; reason?: string } {
  if (!config.remote.enabled) return { started: false, reason: 'disabled' };
  if (remoteServer) return { started: true };

  // An admin password is a hard prerequisite: without it apiAuth would run open
  // on the internet-facing surface. Refuse rather than expose an open server.
  if (!config.auth.adminPasswordHash) {
    const reason = 'ADMIN_PASSWORD_HASH (mandatory auth for the remote surface)';
    console.error(
      `[Remote] REMOTE_ACCESS is on but the remote listener is REFUSING TO START — ` +
        `missing prerequisites: ${reason}. The LAN listener is unaffected.`,
    );
    return { started: false, reason };
  }

  const remoteApp = express();
  // Behind a loopback TLS terminator (BYO reverse proxy / tunnel) for now;
  // M8 tightens this to the managed per-server cert terminator.
  remoteApp.set('trust proxy', 'loopback');
  remoteApp.use(corsMiddleware);
  remoteApp.use(express.json());
  mountApiRoutes(remoteApp, 'remote'); // consumer routes only — no admin, no setup
  remoteApp.use(makeErrorHandler('remote'));
  // Intentionally NO initWebSocket here — a WS upgrade bypasses apiAuth and the
  // not-mounted invariant (see 04-implementation-plan.md H4).
  const srv = createServer(remoteApp);
  srv.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[Remote] Listener error on port ${config.remote.port}:`, err);
  });
  srv.listen(config.remote.port, () => {
    console.log(
      `[Remote] Consumer-only listener on port ${config.remote.port} — ` +
        `admin routes not mounted, WebSocket disabled, auth mandatory.`,
    );
  });
  remoteServer = srv;
  return { started: true };
}

/** Stop the remote listener if running. Idempotent. */
export function stopRemoteListener(): void {
  if (!remoteServer) return;
  remoteServer.close();
  remoteServer = null;
  console.log('[Remote] Consumer-only listener stopped.');
}
