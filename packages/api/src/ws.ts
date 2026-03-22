import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

/**
 * Initialize WebSocket server attached to the existing HTTP server.
 */
export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected (${clients.size} total)`);

    // Send initial ping
    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  console.log('[WS] WebSocket server ready on /ws');
}

/**
 * Broadcast an invalidation event to all connected clients.
 * The app will invalidate its React Query cache for the specified keys.
 */
export function broadcast(event: {
  type: 'invalidate' | 'update';
  keys: string[];       // React Query keys to invalidate, e.g. ['home'], ['tv', 'recent']
  reason?: string;      // Human-readable reason for logs
}): void {
  if (clients.size === 0) return;

  const message = JSON.stringify({
    ...event,
    timestamp: Date.now(),
  });

  let sent = 0;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sent++;
    }
  }

  if (sent > 0) {
    console.log(`[WS] Broadcast "${event.reason || event.type}" to ${sent} clients (keys: ${event.keys.join(', ')})`);
  }
}

/**
 * Notify all clients that data has changed.
 * Call this after any mutation (scrobble, mark watched, add tracked, etc.)
 */
export function notifyDataChanged(reason: string, ...keys: string[]): void {
  // Invalidate the backend cache first
  const { invalidateAll } = require('./cache.js');
  invalidateAll();

  // Then tell all clients to refetch
  broadcast({
    type: 'invalidate',
    keys: keys.length > 0 ? keys : ['home', 'tv', 'movies', 'tracked'],
    reason,
  });
}
