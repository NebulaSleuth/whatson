import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from './store';

/**
 * Connects to the backend WebSocket and invalidates React Query caches
 * when the server broadcasts data changes.
 *
 * Also handles:
 * - Auto-reconnect on disconnect
 * - Reconnect when app comes to foreground
 * - Full invalidation on reconnect (catch up on missed events)
 */
export function useRealtimeUpdates() {
  const queryClient = useQueryClient();
  const { apiUrl } = useAppStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!apiUrl) return;

    function connect() {
      // Build WebSocket URL from API URL
      const wsUrl = apiUrl
        .replace(/^http/, 'ws')
        .replace(/\/api\/?$/, '/ws');

      console.log(`[WS] Connecting to ${wsUrl}`);

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[WS] Connected');
          // Clear any pending reconnect
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
            reconnectTimer.current = null;
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string);

            if (data.type === 'invalidate' && data.keys) {
              console.log(`[WS] Invalidating: ${data.keys.join(', ')} (${data.reason || ''})`);

              for (const key of data.keys) {
                // Invalidate all queries that start with this key
                queryClient.invalidateQueries({ queryKey: [key] });
              }
            }
          } catch {}
        };

        ws.onclose = () => {
          console.log('[WS] Disconnected');
          wsRef.current = null;
          scheduleReconnect();
        };

        ws.onerror = () => {
          // onclose will fire after this
        };
      } catch {
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (reconnectTimer.current) return;
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        connect();
      }, 5000); // Retry every 5 seconds
    }

    function disconnect() {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    }

    // Connect on mount
    connect();

    // Reconnect when app comes to foreground
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          connect();
        }
        // Invalidate everything on foreground to catch up
        queryClient.invalidateQueries();
      }
    });

    return () => {
      disconnect();
      appStateSubscription.remove();
    };
  }, [apiUrl, queryClient]);
}
