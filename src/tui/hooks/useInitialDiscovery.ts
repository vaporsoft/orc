import { useState, useEffect } from "react";
import type { Daemon } from "../../core/daemon.js";

/** Timeout (ms) after which we stop showing "Discovering PRs…" even if the
 *  first fetch hasn't returned yet. */
const DISCOVERY_TIMEOUT_MS = 10_000;

/**
 * Returns `true` while the daemon's initial PR discovery is still in progress.
 * Falls back to `false` after {@link DISCOVERY_TIMEOUT_MS} so the TUI defaults
 * to the empty state instead of showing "Discovering PRs…" indefinitely.
 */
export function useInitialDiscovery(daemon: Daemon): boolean {
  const [discovering, setDiscovering] = useState(
    () => !daemon.hasCompletedInitialDiscovery(),
  );

  useEffect(() => {
    if (!discovering) return;

    // Re-check synchronously to close the gap between render and effect:
    // the event may have fired between useState init and useEffect execution.
    if (daemon.hasCompletedInitialDiscovery()) {
      setDiscovering(false);
      return;
    }

    const done = () => setDiscovering(false);

    daemon.on("initialDiscoveryComplete", done);
    const timer = setTimeout(done, DISCOVERY_TIMEOUT_MS);

    return () => {
      daemon.off("initialDiscoveryComplete", done);
      clearTimeout(timer);
    };
  }, [daemon, discovering]);

  return discovering;
}
