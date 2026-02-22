import { useState, useEffect, useRef } from "react";
import type { Daemon } from "../../core/daemon.js";

/**
 * Returns the number of seconds until the next discovery check,
 * or null if no check has been scheduled yet.
 */
export function useNextCheckCountdown(daemon: Daemon, paused = false): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const tick = () => {
      if (pausedRef.current) return;
      const nextAt = daemon.getNextCheckAt();
      if (nextAt === null) {
        setSecondsLeft(null);
        return;
      }
      const remaining = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };

    const onDiscovery = () => {
      tick();
    };

    daemon.on("discoveryComplete", onDiscovery);
    daemon.on("configUpdate", onDiscovery);

    // Tick once immediately and then every second
    tick();
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      daemon.off("discoveryComplete", onDiscovery);
      daemon.off("configUpdate", onDiscovery);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [daemon]);

  return secondsLeft;
}
