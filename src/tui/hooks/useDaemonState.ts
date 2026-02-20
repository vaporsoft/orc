import { useState, useEffect } from "react";
import type { Daemon } from "../../core/daemon.js";
import type { BranchState } from "../../types/index.js";

export function useDaemonState(daemon: Daemon): Map<string, BranchState> {
  const [sessions, setSessions] = useState<Map<string, BranchState>>(() => {
    const initial = new Map<string, BranchState>();
    for (const [branch, controller] of daemon.getSessions()) {
      initial.set(branch, controller.getState());
    }
    return initial;
  });

  useEffect(() => {
    const onAdded = (branch: string, state: BranchState) => {
      setSessions((prev) => {
        const next = new Map(prev);
        next.set(branch, state);
        return next;
      });
    };

    const onUpdate = (branch: string, state: BranchState) => {
      setSessions((prev) => {
        const next = new Map(prev);
        next.set(branch, state);
        return next;
      });
    };

    const onRemoved = (branch: string) => {
      setSessions((prev) => {
        const next = new Map(prev);
        next.delete(branch);
        return next;
      });
    };

    daemon.on("sessionAdded", onAdded);
    daemon.on("sessionUpdate", onUpdate);
    daemon.on("sessionRemoved", onRemoved);

    return () => {
      daemon.off("sessionAdded", onAdded);
      daemon.off("sessionUpdate", onUpdate);
      daemon.off("sessionRemoved", onRemoved);
    };
  }, [daemon]);

  return sessions;
}
