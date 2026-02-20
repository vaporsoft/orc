import React, { useState, useCallback } from "react";
import { Box, useApp, useInput, useStdin, useStdout } from "ink";
import type { Daemon } from "../core/daemon.js";
import { useDaemonState } from "./hooks/useDaemonState.js";
import { useLogBuffer } from "./hooks/useLogBuffer.js";
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

  const termHeight = stdout?.rows ?? 24;
  const logVisibleLines = Math.max(3, termHeight - 12);

  const entryCount = entries.size;
  const showLogs = focusedPane === "logs";
  const branches = [...entries.keys()].sort();

  const onQuit = useCallback(() => {
    exit();
  }, [exit]);

  useInput((input, key) => {
    if (input === "q") {
      onQuit();
      return;
    }

    if (input === "R") {
      daemon.refreshNow().catch(() => {});
      return;
    }

    if (key.tab) {
      setFocusedPane((prev) => (prev === "sessions" ? "logs" : "sessions"));
      return;
    }

    // Toggle selected PR on/off
    if (key.return && focusedPane === "sessions") {
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
    if (input === "A") {
      daemon.startAll().catch(() => {});
      return;
    }

    // Stop all
    if (input === "X") {
      daemon.stopAll().catch(() => {});
      return;
    }

    if (focusedPane === "sessions") {
      if (key.upArrow) {
        setSessionIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSessionIndex((prev) => Math.min(entryCount - 1, prev + 1));
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
      <DetailPanel entries={entries} selectedIndex={sessionIndex} />
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
