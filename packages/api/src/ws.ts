import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();
let pollInterval: ReturnType<typeof setInterval> | null = null;

// Snapshot of last data hash — used to detect changes
let lastDataHash = '';

/**
 * Initialize WebSocket server attached to the existing HTTP server.
 * Starts a background poller that checks for data changes every 60 seconds.
 */
export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected (${clients.size} total)`);

    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  // Start background polling
  startPoller();

  console.log('[WS] WebSocket server ready on /ws (polling every 60s)');
}

/**
 * Background poller — checks Plex/Sonarr/Radarr for changes every 60 seconds.
 * If data has changed since last poll, invalidates caches and notifies clients.
 */
function startPoller(): void {
  if (pollInterval) return;

  pollInterval = setInterval(async () => {
    if (clients.size === 0) return; // No clients — skip

    try {
      const { getHomeData } = require('./services/aggregator.js');
      const { invalidateAll } = require('./cache.js');

      // Bust the cache to force fresh data
      invalidateAll();

      // Fetch fresh data
      const data = await getHomeData();

      // Create a simple hash of the data to detect changes
      const hash = createDataHash(data);

      if (lastDataHash && hash !== lastDataHash) {
        console.log('[Poll] Data changed — notifying clients');
        broadcast({
          type: 'invalidate',
          keys: ['home', 'tv', 'movies', 'tracked'],
          reason: 'poll-detected-change',
        });
      }

      lastDataHash = hash;
    } catch (error) {
      console.warn('[Poll] Error checking for updates:', (error as Error).message);
    }
  }, 60000); // Every 60 seconds
}

/**
 * Create a lightweight hash of the home data to detect changes.
 * Uses item IDs, statuses, and progress to detect meaningful changes.
 */
function createDataHash(data: any): string {
  if (!data?.sections) return '';

  const parts: string[] = [];
  for (const section of data.sections) {
    for (const item of section.items || []) {
      parts.push(`${item.id}:${item.status}:${item.progress?.percentage || 0}:${item.progress?.watched || false}`);
    }
  }
  return parts.join('|');
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
    keys: keys.length > 0 ? keys : ['home', 'tv', 'movies', 'tracked', 'live'],
    reason,
  });
}
