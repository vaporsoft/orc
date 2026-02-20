import React, { useState, useCallback } from "react";
import { Box, useApp, useInput, useStdin, useStdout } from "ink";
import type { Daemon } from "../core/daemon.js";
import { logger } from "../utils/logger.js";
import { useDaemonState } from "./hooks/useDaemonState.js";
import { useLogBuffer } from "./hooks/useLogBuffer.js";
import { useBranchLogs } from "./hooks/useBranchLogs.js";
import { Header } from "./components/Header.js";
import { SessionList } from "./components/SessionList.js";
import { DetailPanel } from "./components/DetailPanel.js";
import { LogPane } from "./components/LogPane.js";
import { HelpBar } from "./components/HelpBar.js";

type Pane = "sessions" | "logs";

interface AppProps {
  daemon: Daemon;
  startTime: number;
}

export function App({ daemon, startTime }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  const entries = useDaemonState(daemon);
  const { entries: logEntries, lastTimestamp } = useLogBuffer();
  const [focusedPane, setFocusedPane] = useState<Pane>("sessions");
  const [sessionIndex, setSessionIndex] = useState(0);
  const [logOffset, setLogOffset] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [detailLogOffset, setDetailLogOffset] = useState(0);

  const termHeight = stdout?.rows ?? 24;
  const logVisibleLines = Math.max(3, termHeight - 12);
  // Branch log area gets roughly half the remaining space
  const branchLogLines = Math.max(3, Math.floor((termHeight - 16) / 2));

  const entryCount = entries.size;
  const showLogs = focusedPane === "logs";
  const branches = [...entries.keys()].sort();
  const selectedBranch = branches[sessionIndex] ?? null;

  const branchLogs = useBranchLogs(selectedBranch);

  const onQuit = useCallback(() => {
    exit();
  }, [exit]);

  useInput((input, key) => {
    if (input === "q") {
      onQuit();
      return;
    }

    if (input === "r") {
      daemon.refreshNow().catch(() => {});
      return;
    }

    if (key.tab) {
      setFocusedPane((prev) => (prev === "sessions" ? "logs" : "sessions"));
      return;
    }

    // Toggle detail pane for selected branch
    if (key.return && focusedPane === "sessions") {
      setShowDetail((prev) => !prev);
      setDetailLogOffset(0); // Reset scroll when toggling
      return;
    }

    // Start/stop selected branch
    if (input === "s" && focusedPane === "sessions") {
      const branch = branches[sessionIndex];
      if (branch) {
        if (daemon.isRunning(branch)) {
          daemon.stopBranch(branch).catch(() => {});
        } else {
          daemon.startBranch(branch).catch(() => {});
        }
      }
      return;
    }

    // Start all
    if (input === "a") {
      daemon.startAll().catch((err) => {
        logger.error(`startAll failed: ${err}`);
      });
      return;
    }

    // Stop all
    if (input === "x") {
      daemon.stopAll().catch((err) => {
        logger.error(`stopAll failed: ${err}`);
      });
      return;
    }

    // j/k always navigate the session list
    if (input === "k" && focusedPane === "sessions") {
      setSessionIndex((prev) => Math.max(0, prev - 1));
      setDetailLogOffset(0);
      return;
    }
    if (input === "j" && focusedPane === "sessions") {
      setSessionIndex((prev) => Math.min(entryCount - 1, prev + 1));
      setDetailLogOffset(0);
      return;
    }

    if (focusedPane === "sessions") {
      if (showDetail) {
        // When detail is open, arrows scroll the branch log
        if (key.upArrow) {
          setDetailLogOffset((prev) => Math.min(prev + 1, Math.max(0, branchLogs.length - branchLogLines)));
        } else if (key.downArrow) {
          setDetailLogOffset((prev) => Math.max(0, prev - 1));
        }
      } else {
        // When detail is closed, arrows navigate the session list
        if (key.upArrow) {
          setSessionIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSessionIndex((prev) => Math.min(entryCount - 1, prev + 1));
        }
      }
    } else {
      if (key.upArrow) {
        setLogOffset((prev) => Math.min(prev + 1, Math.max(0, logEntries.length - logVisibleLines)));
      } else if (key.downArrow) {
        setLogOffset((prev) => Math.max(0, prev - 1));
      }
    }
  }, { isActive: isRawModeSupported });

  return (
    <Box flexDirection="column">
      <Header entries={entries} startTime={startTime} lastCheck={lastTimestamp} />
      <SessionList
        entries={entries}
        selectedIndex={sessionIndex}
        focused={focusedPane === "sessions"}
      />
      <DetailPanel
        entries={entries}
        selectedIndex={sessionIndex}
        showDetail={showDetail}
        branchLogs={branchLogs}
        logScrollOffset={detailLogOffset}
        logVisibleLines={branchLogLines}
      />
      {showLogs && (
        <LogPane
          entries={logEntries}
          focused={true}
          scrollOffset={logOffset}
          visibleLines={logVisibleLines}
        />
      )}
      <HelpBar showingLogs={showLogs} />
    </Box>
  );
}
