import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from './store';

/**
 * Global flag to suppress WebSocket updates during playback.
 * Set to true when the player is active, false when it exits.
 */
let _suppressUpdates = false;

export function suppressRealtimeUpdates(suppress: boolean) {
  _suppressUpdates = suppress;
}

/**
 * Connects to the backend WebSocket and invalidates React Query caches
 * when the server broadcasts data changes.
 *
 * Suppressed during video playback to prevent stale data from
 * overwriting the current play position.
 */
export function useRealtimeUpdates() {
  const queryClient = useQueryClient();
  const { apiUrl } = useAppStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInvalidation = useRef(false);

  useEffect(() => {
    if (!apiUrl) return;

    function connect() {
      const wsUrl = apiUrl
        .replace(/^http/, 'ws')
        .replace(/\/api\/?$/, '/ws');

      console.log(`[WS] Connecting to ${wsUrl}`);

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[WS] Connected');
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
            reconnectTimer.current = null;
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string);

            if (data.type === 'invalidate' && data.keys) {
              if (_suppressUpdates) {
                // Player is active — queue the invalidation for when it exits
                console.log(`[WS] Suppressed (playback active): ${data.keys.join(', ')}`);
                pendingInvalidation.current = true;
                return;
              }

              console.log(`[WS] Invalidating: ${data.keys.join(', ')} (${data.reason || ''})`);
              for (const key of data.keys) {
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

        ws.onerror = () => {};
      } catch {
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (reconnectTimer.current) return;
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        connect();
      }, 5000);
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

    connect();

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          connect();
        }
        // If updates were suppressed, flush now
        if (pendingInvalidation.current && !_suppressUpdates) {
          pendingInvalidation.current = false;
          queryClient.invalidateQueries();
        } else if (!_suppressUpdates) {
          queryClient.invalidateQueries();
        }
      }
    });

    // Check periodically if suppression was lifted and there are pending invalidations
    const flushInterval = setInterval(() => {
      if (pendingInvalidation.current && !_suppressUpdates) {
        pendingInvalidation.current = false;
        console.log('[WS] Flushing pending invalidation (playback ended)');
        queryClient.invalidateQueries();
      }
    }, 2000);

    return () => {
      disconnect();
      appStateSubscription.remove();
      clearInterval(flushInterval);
    };
  }, [apiUrl, queryClient]);
}
