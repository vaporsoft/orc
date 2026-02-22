import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, useApp, useInput, useStdin, useStdout } from "ink";
import type { Daemon } from "../core/daemon.js";
import { openTerminal } from "../utils/open-terminal.js";
import { logger } from "../utils/logger.js";
import { useDaemonState } from "./hooks/useDaemonState.js";
import { useLogBuffer } from "./hooks/useLogBuffer.js";
import { useBranchLogs } from "./hooks/useBranchLogs.js";
import { useTerminalFocus } from "./hooks/useTerminalFocus.js";
import { Header } from "./components/Header.js";
import type { ToolbarButton } from "./components/Toolbar.js";
import { SessionList } from "./components/SessionList.js";
import { DetailPanel } from "./components/DetailPanel.js";
import { LogPane } from "./components/LogPane.js";

import { HelpBar } from "./components/HelpBar.js";
import { useThemeContext } from "./theme.js";

type Pane = "sessions" | "logs";

interface AppProps {
  daemon: Daemon;
  startTime: number;
}

export function App({ daemon, startTime }: AppProps) {
  const { theme, toggleTheme } = useThemeContext();
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  const terminalFocused = useTerminalFocus();
  const renderPaused = !terminalFocused;
  const entries = useDaemonState(daemon, renderPaused);
  const { entries: logEntries, lastTimestamp } = useLogBuffer(renderPaused);
  const [focusedPane, setFocusedPane] = useState<Pane>("sessions");
  const [sessionIndex, setSessionIndex] = useState(0);
  const [logOffset, setLogOffset] = useState(0);
  const [detailMode, setDetailMode] = useState<"off" | "detail" | "logs">("off");
  const [detailModeBeforeLogs, setDetailModeBeforeLogs] = useState<"off" | "detail" | "logs">("off");
  const [showHelp, setShowHelp] = useState(false);
  const [branchLogOffset, setBranchLogOffset] = useState(0);
  const [toolbarIndex, setToolbarIndex] = useState(-1);

  const termHeight = stdout?.rows ?? 24;
  const logVisibleLines = Math.max(3, termHeight - 12);
  const branchLogLines = Math.max(3, Math.floor((termHeight - 16) / 2));

  const showLogs = focusedPane === "logs";

  // Split branches into open and merged
  const { openBranches, mergedBranches } = useMemo(() => {
    const open: string[] = [];
    const merged: string[] = [];
    for (const [branch, entry] of entries) {
      if (entry.mergedAt != null) {
        merged.push(branch);
      } else {
        open.push(branch);
      }
    }
    open.sort();
    merged.sort();
    return { openBranches: open, mergedBranches: merged };
  }, [entries]);

  const openCount = openBranches.length;

  // Clamp sessionIndex inline to prevent stale index highlighting merged branches
  const clampedSessionIndex = useMemo(() => {
    if (openCount === 0) {
      return -1;
    }
    return Math.max(0, Math.min(sessionIndex, openCount - 1));
  }, [sessionIndex, openCount]);

  // Update sessionIndex state when it gets clamped to keep state in sync
  React.useEffect(() => {
    if (clampedSessionIndex !== sessionIndex) {
      setSessionIndex(clampedSessionIndex);
    }
  }, [clampedSessionIndex, sessionIndex]);

  const selectedBranch = openBranches[clampedSessionIndex] ?? null;

  const branchLogs = useBranchLogs(selectedBranch, renderPaused);

  const selectedEntry = selectedBranch ? entries.get(selectedBranch) : undefined;
  const activityLines = selectedEntry?.state?.claudeActivity ?? [];

  // Auto-focus a session that enters conflict_prompt
  useEffect(() => {
    const conflictIndex = openBranches.findIndex((b) => {
      const e = entries.get(b);
      return e?.state?.status === "conflict_prompt";
    });
    if (conflictIndex >= 0) {
      setSessionIndex(conflictIndex);
      setDetailMode("detail");
      setFocusedPane("sessions");
    }
  }, [entries]);

  const toolbarButtons: ToolbarButton[] = [
    { label: "Start All", action: () => daemon.startAll("once").catch((err) => logger.error(`startAll failed: ${err}`)) },
    { label: "Watch All", action: () => daemon.watchAll().catch((err) => logger.error(`watchAll failed: ${err}`)) },
    { label: "Stop All", action: () => daemon.stopAll().catch((err) => logger.error(`stopAll failed: ${err}`)) },
    { label: "Refresh", action: () => daemon.refreshNow().catch((err) => logger.error(`refresh failed: ${err}`)) },
  ];

  const onQuit = useCallback(() => {
    exit();
  }, [exit]);

  const onClearMerged = useCallback(() => {
    daemon.clearMergedPRs();
  }, [daemon]);

  useInput((input, key) => {
    if (input === "q") {
      onQuit();
      return;
    }

    if (input === "?") {
      setShowHelp((v) => !v);
      return;
    }

    if (input === "t") {
      toggleTheme();
      return;
    }

    // Clear merged branches
    if (input === "d" && mergedBranches.length > 0) {
      onClearMerged();
      return;
    }

    // Conflict resolution: R to resolve once, A to always auto-resolve
    if (focusedPane === "sessions") {
      const branch = openBranches[sessionIndex];
      const entry = branch ? entries.get(branch) : undefined;
      if (entry?.state?.status === "conflict_prompt") {
        if (input === "r" || input === "R") {
          daemon.resolveConflicts(branch, false);
          return;
        }
        if (input === "a" || input === "A") {
          daemon.resolveConflicts(branch, true);
          return;
        }
        if (key.escape) {
          daemon.dismissConflictResolution(branch);
          return;
        }
      }
    }

    // Plain git rebase (no Claude)
    if (input === "r" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      if (branch && !daemon.isRunning(branch)) {
        daemon.rebaseBranchPlain(branch).catch(() => {});
      }
      return;
    }

    // Rebase + Claude conflict resolution
    if (input === "f" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      if (branch && !daemon.isRunning(branch)) {
        daemon.rebaseBranch(branch).catch(() => {});
      }
      return;
    }

    if (key.tab) {
      setFocusedPane((prev) => {
        if (prev === "sessions") {
          // Switching to logs — save and hide detail views
          setDetailModeBeforeLogs(detailMode);
          setDetailMode("off");
          return "logs";
        } else {
          // Switching back — restore detail state
          setDetailMode(detailModeBeforeLogs);
          return "sessions";
        }
      });
      return;
    }

    // Toolbar: Enter activates focused button
    if ((key.return || input === "\n") && toolbarIndex >= 0) {
      toolbarButtons[toolbarIndex]?.action();
      return;
    }

    // Toolbar: Escape deselects
    if (key.escape && toolbarIndex >= 0) {
      setToolbarIndex(-1);
      return;
    }

    // Toolbar: left/right navigate between buttons
    if (key.leftArrow && toolbarIndex >= 0) {
      setToolbarIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow && toolbarIndex >= 0) {
      setToolbarIndex((prev) => Math.min(toolbarButtons.length - 1, prev + 1));
      return;
    }

    // Toolbar: down arrow exits toolbar back to session list
    if (key.downArrow && toolbarIndex >= 0) {
      setToolbarIndex(-1);
      return;
    }

    // Toggle detail pane for selected branch (handle both \r and \n)
    if ((key.return || input === "\n") && focusedPane === "sessions") {
      setDetailMode((prev) => prev === "detail" ? "off" : "detail");
      return;
    }

    // Swap detail view with branch logs
    if (input === "l" && focusedPane === "sessions") {
      setDetailMode((prev) => prev === "logs" ? "off" : "logs");
      setBranchLogOffset(0);
      return;
    }

    // Start/stop selected branch (one-shot)
    if (input === "s" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      if (branch) {
        if (daemon.isRunning(branch)) {
          daemon.stopBranch(branch).catch(() => {});
        } else {
          daemon.startBranch(branch, "once").catch(() => {});
        }
      }
      return;
    }

    // Watch selected branch (continuous)
    if (input === "w" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      if (branch && !daemon.isRunning(branch)) {
        daemon.watchBranch(branch).catch(() => {});
      }
      return;
    }

    // Start all (one-shot)
    if (input === "a") {
      daemon.startAll("once").catch((err) => {
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
      const branch = openBranches[clampedSessionIndex];
      const entry = branch ? entries.get(branch) : undefined;
      const st = entry?.state;
      if (st?.lastSessionId && st.workDir) {
        openTerminal(`cd '${st.workDir}' && claude --resume ${st.lastSessionId}`);
        logger.info(`Resuming Claude session ${st.lastSessionId}`, branch);
      } else {
        logger.warn("No Claude session to resume for this branch", branch);
      }
      return;
    }

    // Open worktree shell in new terminal
    if (input === "e" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      const entry = branch ? entries.get(branch) : undefined;
      const st = entry?.state;
      if (st?.workDir) {
        openTerminal(`cd '${st.workDir}'`);
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
      setSessionIndex((prev) => Math.min(openCount - 1, prev + 1));
      setBranchLogOffset(0);
      return;
    }

    if (focusedPane === "sessions") {
      if (detailMode === "logs") {
        // When branch logs are open, arrows scroll the branch log
        if (key.upArrow) {
          setBranchLogOffset((prev) => Math.min(prev + 1, Math.max(0, branchLogs.length - branchLogLines)));
        } else if (key.downArrow) {
          setBranchLogOffset((prev) => Math.max(0, prev - 1));
        }
      } else {
        if (key.upArrow) {
          if (sessionIndex === 0) {
            // At top of session list — move focus up into toolbar
            setToolbarIndex(0);
          } else {
            setSessionIndex((prev) => prev - 1);
          }
        } else if (key.downArrow) {
          setSessionIndex((prev) => Math.min(openCount - 1, prev + 1));
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
      <Header entries={entries} startTime={startTime} lastCheck={lastTimestamp} buttons={toolbarButtons} selectedButton={toolbarIndex} />
      <SessionList
        entries={entries}
        selectedIndex={clampedSessionIndex}
        focused={focusedPane === "sessions" && toolbarIndex < 0}
        openBranches={openBranches}
        mergedBranches={mergedBranches}
        renderPaused={renderPaused}
      />
      {detailMode !== "logs" && (
        <DetailPanel
          entries={entries}
          selectedBranch={selectedBranch}
          showDetail={detailMode === "detail"}
          activityLines={activityLines}
        />
      )}
      {detailMode === "logs" && (
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
      {/* Spacer fills remaining height, borders connect the frame */}
      <Box
        flexGrow={1}
        borderStyle="round"
        borderColor={theme.border}
        borderTop={false}
        borderBottom={false}
      />
      <HelpBar showingLogs={showLogs} expanded={showHelp} />
    </Box>
  );
}
