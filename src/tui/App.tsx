import React, { useState, useCallback } from "react";
import { Box, useApp, useInput, useStdin, useStdout } from "ink";
import { execFile } from "node:child_process";
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
  const [showBranchLogs, setShowBranchLogs] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [branchLogOffset, setBranchLogOffset] = useState(0);

  const termHeight = stdout?.rows ?? 24;
  const logVisibleLines = Math.max(3, termHeight - 12);
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

    if (input === "?") {
      setShowHelp((v) => !v);
      return;
    }

    // Retry/restart errored or stopped session
    if (input === "r" && focusedPane === "sessions") {
      const branch = branches[sessionIndex];
      if (branch && !daemon.isRunning(branch)) {
        daemon.startBranch(branch).catch(() => {});
      }
      return;
    }

    if (key.tab) {
      setFocusedPane((prev) => (prev === "sessions" ? "logs" : "sessions"));
      return;
    }

    // Toggle detail pane for selected branch (handle both \r and \n)
    if ((key.return || input === "\n") && focusedPane === "sessions") {
      setShowDetail((prev) => !prev);
      return;
    }

    // Toggle branch logs for selected branch
    if (input === "l" && focusedPane === "sessions") {
      setShowBranchLogs((prev) => !prev);
      setBranchLogOffset(0);
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

    // Resume Claude session in new terminal
    if (input === "c" && focusedPane === "sessions") {
      const branch = branches[sessionIndex];
      const entry = branch ? entries.get(branch) : undefined;
      const st = entry?.state;
      if (st?.lastSessionId && st.workDir) {
        const script = `cd '${st.workDir}' && claude --resume ${st.lastSessionId}`;
        execFile("osascript", [
          "-e", `tell application "Terminal"`,
          "-e", `activate`,
          "-e", `do script "${script.replace(/"/g, '\\"')}"`,
          "-e", `end tell`,
        ], (err) => {
          if (err) logger.error(`Failed to open Claude session: ${err.message}`);
        });
        logger.info(`Resuming Claude session ${st.lastSessionId}`, branch);
      } else {
        logger.warn("No Claude session to resume for this branch", branch);
      }
      return;
    }

    // Open worktree shell in new terminal
    if (input === "w" && focusedPane === "sessions") {
      const branch = branches[sessionIndex];
      const entry = branch ? entries.get(branch) : undefined;
      const st = entry?.state;
      if (st?.workDir) {
        const script = `cd '${st.workDir}'`;
        execFile("osascript", [
          "-e", `tell application "Terminal"`,
          "-e", `activate`,
          "-e", `do script "${script.replace(/"/g, '\\"')}"`,
          "-e", `end tell`,
        ], (err) => {
          if (err) logger.error(`Failed to open terminal: ${err.message}`);
        });
        logger.info(`Opening shell at ${st.workDir}`, branch);
      } else {
        logger.warn("No worktree directory for this branch", branch);
      }
      return;
    }

    // j/k always navigate the session list
    if (input === "k" && focusedPane === "sessions") {
      setSessionIndex((prev) => Math.max(0, prev - 1));
      setBranchLogOffset(0);
      return;
    }
    if (input === "j" && focusedPane === "sessions") {
      setSessionIndex((prev) => Math.min(entryCount - 1, prev + 1));
      setBranchLogOffset(0);
      return;
    }

    if (focusedPane === "sessions") {
      if (showBranchLogs) {
        // When branch logs are open, arrows scroll the branch log
        if (key.upArrow) {
          setBranchLogOffset((prev) => Math.min(prev + 1, Math.max(0, branchLogs.length - branchLogLines)));
        } else if (key.downArrow) {
          setBranchLogOffset((prev) => Math.max(0, prev - 1));
        }
      } else {
        // Otherwise arrows navigate the session list
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
    <Box flexDirection="column" height={termHeight}>
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
      />
      {showBranchLogs && (
        <LogPane
          entries={branchLogs}
          focused={focusedPane === "sessions"}
          scrollOffset={branchLogOffset}
          visibleLines={branchLogLines}
          label={selectedBranch ? `Logs [${selectedBranch}]` : "Logs"}
        />
      )}
      {showLogs && (
        <LogPane
          entries={logEntries}
          focused={focusedPane === "logs"}
          scrollOffset={logOffset}
          visibleLines={logVisibleLines}
          label="All Logs"
        />
      )}
      {/* Spacer fills remaining height, green borders connect the frame */}
      <Box
        flexGrow={1}
        borderStyle="round"
        borderColor="green"
        borderTop={false}
        borderBottom={false}
      />
      <HelpBar showingLogs={showLogs} expanded={showHelp} />
    </Box>
  );
}
