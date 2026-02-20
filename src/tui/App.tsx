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
  const sessions = useDaemonState(daemon);
  const { entries: logEntries, lastTimestamp } = useLogBuffer();
  const [focusedPane, setFocusedPane] = useState<Pane>("sessions");
  const [sessionIndex, setSessionIndex] = useState(0);
  const [logOffset, setLogOffset] = useState(0);

  const termHeight = stdout?.rows ?? 24;
  const logVisibleLines = Math.max(3, termHeight - 12);

  const sessionCount = sessions.size;
  const showLogs = focusedPane === "logs";

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

    if (focusedPane === "sessions") {
      if (key.upArrow) {
        setSessionIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSessionIndex((prev) => Math.min(sessionCount - 1, prev + 1));
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
      <Header sessions={sessions} startTime={startTime} lastCheck={lastTimestamp} />
      <SessionList
        sessions={sessions}
        selectedIndex={sessionIndex}
        focused={focusedPane === "sessions"}
      />
      <DetailPanel sessions={sessions} selectedIndex={sessionIndex} />
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
