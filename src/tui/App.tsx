import React, { useState, useCallback, useLayoutEffect, useMemo } from "react";
import { Box, useApp, useInput, useStdin, useStdout } from "ink";
import type { Daemon } from "../core/daemon.js";
import { openTerminal, shellEscape } from "../utils/open-terminal.js";
import { logger } from "../utils/logger.js";
import { useDaemonState } from "./hooks/useDaemonState.js";
import { useLogBuffer } from "./hooks/useLogBuffer.js";
import { useBranchLogs } from "./hooks/useBranchLogs.js";
import { useNextCheckCountdown } from "./hooks/useNextCheckCountdown.js";
import { useInitialDiscovery } from "./hooks/useInitialDiscovery.js";
import { Header } from "./components/Header.js";
import type { ToolbarButton } from "./components/Toolbar.js";
import { SessionList } from "./components/SessionList.js";
import { DetailPanel, getVisibleSections } from "./components/DetailPanel.js";
import type { DetailSection } from "./components/DetailPanel.js";
import { LogPane } from "./components/LogPane.js";

import { HelpBar } from "./components/HelpBar.js";
import { KeybindLegend } from "./components/KeybindLegend.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { AddBranchModal } from "./components/AddBranchModal.js";
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
  const entries = useDaemonState(daemon);
  const { entries: logEntries } = useLogBuffer();
  const nextCheckIn = useNextCheckCountdown(daemon);
  const isDiscovering = useInitialDiscovery(daemon);
  const [focusedPane, setFocusedPane] = useState<Pane>("sessions");
  const [sessionIndex, setSessionIndex] = useState(0);
  const [logOffset, setLogOffset] = useState(0);
  const [detailMode, setDetailMode] = useState<"off" | "detail" | "logs">("off");
  const [detailModeBeforeLogs, setDetailModeBeforeLogs] = useState<"off" | "detail" | "logs">("off");
  const [branchLogOffset, setBranchLogOffset] = useState(0);
  const [toolbarIndex, setToolbarIndex] = useState(-1);
  const [showSettings, setShowSettings] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [focusedSection, setFocusedSection] = useState<DetailSection | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<DetailSection>>(new Set());

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
  // useLayoutEffect prevents a flickering frame with the stale out-of-bounds index
  React.useLayoutEffect(() => {
    if (clampedSessionIndex !== sessionIndex) {
      setSessionIndex(clampedSessionIndex);
    }
  }, [clampedSessionIndex, sessionIndex]);

  const selectedBranch = openBranches[clampedSessionIndex] ?? null;

  // Track previous selected branch to detect when it changes (e.g., due to sorting shifts)
  // useLayoutEffect prevents the detail panel from flickering with stale section state
  const prevSelectedBranchRef = React.useRef<string | null>(selectedBranch);
  React.useLayoutEffect(() => {
    if (prevSelectedBranchRef.current !== selectedBranch) {
      // Branch changed (even if index stayed same due to list reordering)
      setFocusedSection(null);
      setCollapsedSections(new Set());
      prevSelectedBranchRef.current = selectedBranch;
    }
  }, [selectedBranch]);

  const branchLogs = useBranchLogs(selectedBranch);

  const selectedEntry = selectedBranch ? entries.get(selectedBranch) : undefined;
  const activityLines = selectedEntry?.state?.claudeActivity ?? [];
  const visibleSections = getVisibleSections(selectedEntry);

  // Auto-focus a session that enters conflict_prompt (only when newly entering that status)
  const [prevConflictBranches, setPrevConflictBranches] = useState<Set<string>>(new Set());

  // useLayoutEffect prevents flickering the old view before switching focus to the conflict branch
  useLayoutEffect(() => {
    const currentConflictBranches = new Set<string>();
    openBranches.forEach((b) => {
      const e = entries.get(b);
      if (e?.state?.status === "conflict_prompt") {
        currentConflictBranches.add(b);
      }
    });

    // Find branches that newly entered conflict_prompt
    const newConflictBranches = [...currentConflictBranches].filter(b => !prevConflictBranches.has(b));

    if (newConflictBranches.length > 0) {
      // Focus on the first branch that newly entered conflict_prompt
      const conflictIndex = openBranches.findIndex(b => b === newConflictBranches[0]);
      if (conflictIndex >= 0) {
        setSessionIndex(conflictIndex);
        setDetailMode("detail");
        setFocusedSection(null); // Will default to first visible section
        setCollapsedSections(new Set()); // Clear collapsed sections for new branch
        setFocusedPane("sessions");
      }
    }

    setPrevConflictBranches(currentConflictBranches);
  }, [entries, openBranches]);

  const toolbarButtons: ToolbarButton[] = [
    { label: "Add Branch", action: () => setShowAddBranch(true) },
    { label: "Fix All", action: () => daemon.startAll("once").catch((err) => logger.error(`startAll failed: ${err}`)) },
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
    // Modal panels — block all other keybindings when open
    if (showSettings || showLegend || showAddBranch) return;

    if (input === "q") {
      onQuit();
      return;
    }

    if (input === "h") {
      setShowLegend(true);
      return;
    }

    if (input === ",") {
      setShowSettings(true);
      return;
    }

    if (input === "t") {
      toggleTheme();
      return;
    }

    if (input === "+") {
      setShowAddBranch(true);
      return;
    }

    // Clear merged branches
    if (input === "d" && mergedBranches.length > 0) {
      onClearMerged();
      return;
    }

    // Conflict resolution: R to resolve once, A to always auto-resolve
    if (focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
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

    // Fix: run full session (comments + CI) for selected branch
    if (input === "f" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      if (branch && !daemon.isRunning(branch)) {
        daemon.startBranch(branch, "once").catch(() => {});
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
      if (detailMode !== "detail") {
        setFocusedSection(null); // Will default to first visible section
      }
      setDetailMode((prev) => prev === "detail" ? "off" : "detail");
      return;
    }

    // Swap detail view with branch logs
    if (input === "l" && focusedPane === "sessions") {
      setDetailMode((prev) => prev === "logs" ? "off" : "logs");
      setBranchLogOffset(0);
      return;
    }

    // Stop selected branch
    if (input === "s" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      if (branch && daemon.isRunning(branch)) {
        daemon.stopBranch(branch).catch(() => {});
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
        openTerminal(`cd ${shellEscape(st.workDir)} && claude --resume ${shellEscape(st.lastSessionId)}`);
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
        openTerminal(`cd ${shellEscape(st.workDir)}`);
        logger.info(`Opening shell at ${st.workDir}`, branch);
      } else {
        logger.warn("No worktree directory for this branch", branch);
      }
      return;
    }

    // Space toggles collapse of focused section in detail view
    if (input === " " && focusedPane === "sessions" && detailMode === "detail" && visibleSections.length > 0) {
      // Use same validation as DetailPanel: check if focusedSection is in visibleSections before using it
      const section = (focusedSection && visibleSections.includes(focusedSection))
        ? focusedSection
        : visibleSections[0];
      if (section) {
        setCollapsedSections((prev) => {
          const next = new Set(prev);
          if (next.has(section)) {
            next.delete(section);
          } else {
            next.add(section);
          }
          return next;
        });
      }
      return;
    }

    // j/k always navigate the session list
    if (input === "k" && focusedPane === "sessions") {
      const nextIndex = Math.max(0, sessionIndex - 1);
      if (nextIndex !== sessionIndex) {
        // Only reset section state when actually changing branches
        setBranchLogOffset(0);
        setFocusedSection(null);
        setCollapsedSections(new Set());
      }
      setSessionIndex(nextIndex);
      return;
    }
    if (input === "j" && focusedPane === "sessions") {
      const nextIndex = Math.min(openCount - 1, sessionIndex + 1);
      if (nextIndex !== sessionIndex) {
        // Only reset section state when actually changing branches
        setBranchLogOffset(0);
        setFocusedSection(null);
        setCollapsedSections(new Set());
      }
      setSessionIndex(nextIndex);
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
      } else if (detailMode === "detail" && visibleSections.length > 0) {
        // When detail panel is open, arrows navigate between sections
        const currentIndex = focusedSection ? visibleSections.indexOf(focusedSection) : 0;
        const effectiveIndex = currentIndex >= 0 ? currentIndex : 0;
        if (key.upArrow) {
          const newIndex = Math.max(0, effectiveIndex - 1);
          setFocusedSection(visibleSections[newIndex] ?? null);
        } else if (key.downArrow) {
          const newIndex = Math.min(visibleSections.length - 1, effectiveIndex + 1);
          setFocusedSection(visibleSections[newIndex] ?? null);
        }
      } else {
        if (key.upArrow) {
          if (sessionIndex === 0) {
            // At top of session list — move focus up into toolbar
            setToolbarIndex(0);
          } else {
            const nextIndex = sessionIndex - 1;
            setBranchLogOffset(0);
            setFocusedSection(null);
            setCollapsedSections(new Set());
            setSessionIndex(nextIndex);
          }
        } else if (key.downArrow) {
          const nextIndex = Math.min(openCount - 1, sessionIndex + 1);
          if (nextIndex !== sessionIndex) {
            setBranchLogOffset(0);
            setFocusedSection(null);
            setCollapsedSections(new Set());
          }
          setSessionIndex(nextIndex);
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
      <Header entries={entries} startTime={startTime} nextCheckIn={nextCheckIn} buttons={toolbarButtons} selectedButton={toolbarIndex} />
      <SessionList
        entries={entries}
        selectedIndex={clampedSessionIndex}
        focused={focusedPane === "sessions" && toolbarIndex < 0}
        openBranches={openBranches}
        mergedBranches={mergedBranches}
        isDiscovering={isDiscovering}
      />
      {detailMode !== "logs" && (
        <DetailPanel
          entries={entries}
          selectedBranch={selectedBranch}
          showDetail={detailMode === "detail"}
          activityLines={activityLines}
          focusedSection={detailMode === "detail" ? focusedSection : null}
          collapsedSections={collapsedSections}
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
      {showSettings && (
        <SettingsPanel
          daemon={daemon}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showLegend && (
        <KeybindLegend
          showingLogs={showLogs}
          onClose={() => setShowLegend(false)}
        />
      )}
      {showAddBranch && (
        <AddBranchModal
          daemon={daemon}
          onClose={() => setShowAddBranch(false)}
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
      <HelpBar />
    </Box>
  );
}
