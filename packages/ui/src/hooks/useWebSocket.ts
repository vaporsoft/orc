import { useEffect, useRef, useCallback } from "react";
import { useDashboardStore } from "../store";
import type { ServerMessage } from "../types";

const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_DELAY);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const applyState = useDashboardStore((s) => s.applyState);
  const updateBranch = useDashboardStore((s) => s.updateBranch);
  const setConnected = useDashboardStore((s) => s.setConnected);
  const setError = useDashboardStore((s) => s.setError);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      reconnectDelay.current = RECONNECT_DELAY;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        switch (msg.type) {
          case "state":
            applyState(msg.data);
            break;
          case "branch_updated":
            updateBranch(msg.data);
            break;
          case "error":
            setError(msg.message);
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;

      // Reconnect with exponential backoff
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(
          reconnectDelay.current * 2,
          MAX_RECONNECT_DELAY
        );
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }, [applyState, updateBranch, setConnected, setError]);

  const sendRefresh = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "refresh" }));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { sendRefresh };
}
