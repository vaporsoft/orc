import React, { useState, useCallback, useLayoutEffect, useMemo } from "react";
import { Box, useApp, useInput, useStdin, useStdout } from "ink";
import type { Daemon } from "../core/daemon.js";
import { copyToClipboard } from "../utils/clipboard.js";
import { openInBrowser } from "../utils/open-url.js";
import { exec } from "../utils/process.js";
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
  const [fullscreenBeforeLogs, setFullscreenBeforeLogs] = useState<DetailSection | null>(null);
  const [branchLogOffset, setBranchLogOffset] = useState(0);
  const [toolbarIndex, setToolbarIndex] = useState(-1);
  const [showSettings, setShowSettings] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [focusedSection, setFocusedSection] = useState<DetailSection | null>(null);
  const [sectionFocus, setSectionFocus] = useState(false); // true when arrow keys navigate sections instead of branches
  const [fullscreenSection, setFullscreenSection] = useState<DetailSection | null>(null);
  const [commentScroll, setCommentScroll] = useState(0);
  const [ciScroll, setCiScroll] = useState(0);
  const [conflictScroll, setConflictScroll] = useState(0);
  const [conflictContent, setConflictContent] = useState<string | null>(null);
  const [conflictContentLoading, setConflictContentLoading] = useState(false);

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
      setSectionFocus(false);
      setFullscreenSection(null);
      setCommentScroll(0);
      setCiScroll(0);
      setConflictScroll(0);
      setConflictContent(null);
      setConflictContentLoading(false);
      prevSelectedBranchRef.current = selectedBranch;
    }
  }, [selectedBranch]);

  const branchLogs = useBranchLogs(selectedBranch);

  const selectedEntry = selectedBranch ? entries.get(selectedBranch) : undefined;
  const activityLines = selectedEntry?.state?.claudeActivity ?? [];
  const summary = selectedEntry?.state?.commentSummary ?? null;
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
        setSectionFocus(false);
        setFullscreenSection(null);
        setFocusedPane("sessions");
      }
    }

    setPrevConflictBranches(currentConflictBranches);
  }, [entries, openBranches]);

  const toolbarButtons: ToolbarButton[] = [
    { label: "Add Branch", action: () => setShowAddBranch(true) },
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

    // Vim-style nav aliases: j=↓ k=↑ l=→ ;=←
    const up = key.upArrow || input === "k";
    const down = key.downArrow || input === "j";
    const right = key.rightArrow || input === "l";
    const left = key.leftArrow || input === ";";
    const tab = key.tab && !key.shift;

    // Exit fullscreen section (must come before global q quit and fullscreen blocker)
    if (fullscreenSection && (input === "q" || key.escape || left)) {
      setFullscreenSection(null);
      return;
    }

    // In fullscreen section: block most actions, only allow specific keys to fall through
    if (fullscreenSection) {
      // Allow: g (logs toggle), h (help), , (settings), t (theme), G (global logs) — fall through
      if (input === "g" || input === "h" || input === "," || input === "t" || input === "G") {
        // Fall through to normal handlers below
      } else if (fullscreenSection === "comments" && (up || down)) {
        // Navigate between comment threads in fullscreen
        const commentList = summary?.comments ?? selectedEntry?.commentThreads ?? [];
        const maxIdx = Math.max(0, commentList.length - 1);
        if (up) {
          setCommentScroll((prev) => Math.max(0, prev - 1));
        } else {
          setCommentScroll((prev) => Math.min(maxIdx, prev + 1));
        }
        return;
      } else if (fullscreenSection === "ci" && (up || down)) {
        // Navigate between CI checks in fullscreen
        const checks = selectedEntry?.failedChecks ?? [];
        const maxIdx = Math.max(0, checks.length - 1);
        if (up) {
          setCiScroll((prev) => Math.max(0, prev - 1));
        } else {
          setCiScroll((prev) => Math.min(maxIdx, prev + 1));
        }
        return;
      } else if (fullscreenSection === "ci" && input === "o") {
        // Open selected CI check in browser
        const checks = selectedEntry?.failedChecks ?? [];
        const check = checks[ciScroll];
        if (check?.htmlUrl) {
          openInBrowser(check.htmlUrl);
          logger.info(`Opening CI check: ${check.name}`, selectedBranch ?? undefined);
        }
        return;
      } else if (fullscreenSection === "conflicts" && (up || down)) {
        // Navigate between conflict files in fullscreen
        const files = selectedEntry?.conflicted ?? [];
        const maxIdx = Math.max(0, files.length - 1);
        if (up) {
          setConflictScroll((prev) => Math.max(0, prev - 1));
        } else {
          setConflictScroll((prev) => Math.min(maxIdx, prev + 1));
        }
        setConflictContent(null);
        setConflictContentLoading(false);
        return;
      } else if (fullscreenSection === "conflicts" && (key.return || input === "\n")) {
        // Load conflict content for selected file
        const branch = openBranches[clampedSessionIndex];
        const files = selectedEntry?.conflicted ?? [];
        const file = files[conflictScroll];
        if (branch && file && file !== "(unknown)") {
          setConflictContentLoading(true);
          daemon.getConflictContent(branch, file).then((content) => {
            setConflictContent(content);
            setConflictContentLoading(false);
          }).catch(() => {
            setConflictContent(null);
            setConflictContentLoading(false);
          });
        }
        return;
      } else {
        return;
      }
    }

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

    // G (shift+g): toggle global logs pane
    if (input === "G") {
      setFocusedPane((prev) => {
        if (prev === "sessions") {
          // Switching to all logs — save and hide detail/fullscreen
          setDetailModeBeforeLogs(detailMode);
          setFullscreenBeforeLogs(fullscreenSection);
          setFullscreenSection(null);
          setDetailMode("off");
          return "logs";
        } else {
          // Switching back — restore detail state
          setDetailMode(detailModeBeforeLogs);
          setFullscreenSection(fullscreenBeforeLogs);
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
    if (left && toolbarIndex >= 0) {
      setToolbarIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (right && toolbarIndex >= 0) {
      setToolbarIndex((prev) => Math.min(toolbarButtons.length - 1, prev + 1));
      return;
    }

    // Toolbar: down arrow exits toolbar back to session list
    if (down && toolbarIndex >= 0) {
      setToolbarIndex(-1);
      return;
    }

    // Enter (context-sensitive): navigate sections or fullscreen
    if ((key.return || input === "\n") && focusedPane === "sessions") {
      if (fullscreenSection) {
        return;
      }
      if (detailMode === "detail" && sectionFocus && visibleSections.length > 0) {
        // Section focus active — enter fullscreens the focused section
        const section = (focusedSection && visibleSections.includes(focusedSection))
          ? focusedSection
          : visibleSections[0];
        if (section) {
          setFullscreenSection(section);
        }
        return;
      }
      if (detailMode === "detail" && visibleSections.length > 0) {
        // Detail open but not in section focus — enter section focus and advance
        if (!sectionFocus) {
          setSectionFocus(true);
          setFocusedSection(visibleSections[0] ?? null);
        }
        return;
      }
      return;
    }

    // Swap detail view with branch logs
    if (input === "g" && focusedPane === "sessions") {
      if (detailMode === "logs") {
        // Returning from logs — restore previous state
        setDetailMode(detailModeBeforeLogs);
        setFullscreenSection(fullscreenBeforeLogs);
      } else {
        // Entering logs — save current state
        setDetailModeBeforeLogs(detailMode);
        setFullscreenBeforeLogs(fullscreenSection);
        setFullscreenSection(null);
        setDetailMode("logs");
      }
      setBranchLogOffset(0);
      return;
    }

    // Copy branch name to clipboard
    if (input === "c" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      if (branch) {
        copyToClipboard(branch);
        logger.info(`Copied branch name: ${branch}`, branch);
      }
      return;
    }

    // Checkout branch locally
    if (input === "C" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      if (branch) {
        exec("git", ["checkout", branch], { cwd: daemon.getCwd() })
          .then(() => logger.info(`Checked out branch: ${branch}`, branch))
          .catch((err) => logger.error(`Failed to checkout ${branch}: ${err}`, branch));
      }
      return;
    }

    // Checkout default branch
    if (input === "M") {
      const defaultBranch = daemon.getDefaultBranch();
      exec("git", ["checkout", defaultBranch], { cwd: daemon.getCwd() })
        .then(() => logger.info(`Checked out ${defaultBranch}`))
        .catch((err) => logger.error(`Failed to checkout ${defaultBranch}: ${err}`));
      return;
    }

    // Copy PR URL to clipboard
    if (input === "u" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      const entry = branch ? entries.get(branch) : undefined;
      if (entry) {
        copyToClipboard(entry.pr.url);
        logger.info(`Copied PR URL: ${entry.pr.url}`, branch);
      }
      return;
    }

    // Open PR in browser
    if (input === "o" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      const entry = branch ? entries.get(branch) : undefined;
      if (entry) {
        openInBrowser(entry.pr.url);
        logger.info(`Opening PR in browser: ${entry.pr.url}`, branch);
      }
      return;
    }

    // Stop selected branch
    if (input === "x" && focusedPane === "sessions") {
      const branch = openBranches[clampedSessionIndex];
      if (branch && daemon.isRunning(branch)) {
        daemon.stopBranch(branch).catch(() => {});
      }
      return;
    }

    // Tab: toggle detail panel open/closed
    if (tab && focusedPane === "sessions" && toolbarIndex < 0) {
      if (detailMode === "detail") {
        // Close detail
        setDetailMode("off");
        setSectionFocus(false);
        setFocusedSection(null);
      } else if (visibleSections.length > 0) {
        // Open detail + focus first section
        setDetailMode("detail");
        setSectionFocus(true);
        setFocusedSection(visibleSections[0] ?? null);
      }
      return;
    }

    // Right: enter section focus when detail is open
    if (right && focusedPane === "sessions" && toolbarIndex < 0) {
      if (detailMode === "detail" && !sectionFocus && visibleSections.length > 0) {
        setSectionFocus(true);
        setFocusedSection(visibleSections[0] ?? null);
      }
      return;
    }

    // Left: exit section focus back to branch navigation (without closing detail)
    if (left && focusedPane === "sessions" && toolbarIndex < 0) {
      if (sectionFocus) {
        setSectionFocus(false);
        setFocusedSection(null);
      }
      return;
    }

    if (focusedPane === "sessions") {
      if (detailMode === "logs") {
        // When branch logs are open, arrows scroll the branch log
        if (up) {
          setBranchLogOffset((prev) => Math.min(prev + 1, Math.max(0, branchLogs.length - branchLogLines)));
        } else if (down) {
          setBranchLogOffset((prev) => Math.max(0, prev - 1));
        }
      } else if (sectionFocus && detailMode === "detail" && visibleSections.length > 0) {
        // Section focus mode: arrows navigate between sections
        const currentIndex = focusedSection ? visibleSections.indexOf(focusedSection) : 0;
        const effectiveIndex = currentIndex >= 0 ? currentIndex : 0;
        if (up) {
          if (effectiveIndex === 0) {
            // At first section — exit section focus, return to branch navigation
            setSectionFocus(false);
            setFocusedSection(null);
          } else {
            setFocusedSection(visibleSections[effectiveIndex - 1] ?? null);
          }
        } else if (down) {
          const newIndex = Math.min(visibleSections.length - 1, effectiveIndex + 1);
          setFocusedSection(visibleSections[newIndex] ?? null);
        }
      } else {
        // Branch navigation (default — works even with detail open)
        if (up) {
          if (sessionIndex === 0) {
            setToolbarIndex(0);
          } else {
            const nextIndex = sessionIndex - 1;
            setBranchLogOffset(0);
            setFocusedSection(null);
            setSectionFocus(false);
            setSessionIndex(nextIndex);
          }
        } else if (down) {
          const nextIndex = Math.min(openCount - 1, sessionIndex + 1);
          if (nextIndex !== sessionIndex) {
            setBranchLogOffset(0);
            setFocusedSection(null);
            setSectionFocus(false);
          }
          setSessionIndex(nextIndex);
        }
      }
    } else {
      if (up) {
        setLogOffset((prev) => Math.min(prev + 1, Math.max(0, logEntries.length - logVisibleLines)));
      } else if (down) {
        setLogOffset((prev) => Math.max(0, prev - 1));
      }
    }
  }, { isActive: isRawModeSupported });

  return (
    <Box flexDirection="column" height={termHeight}>
      <Header entries={entries} startTime={startTime} nextCheckIn={nextCheckIn} buttons={toolbarButtons} selectedButton={toolbarIndex} />
      {!fullscreenSection && (
        <SessionList
          entries={entries}
          selectedIndex={clampedSessionIndex}
          focused={focusedPane === "sessions" && toolbarIndex < 0}
          openBranches={openBranches}
          mergedBranches={mergedBranches}
          isDiscovering={isDiscovering}
        />
      )}
      {detailMode !== "logs" && (
        <DetailPanel
          entries={entries}
          selectedBranch={selectedBranch}
          showDetail={detailMode === "detail"}
          activityLines={activityLines}
          focusedSection={detailMode === "detail" && sectionFocus ? focusedSection : null}
          fullscreenSection={fullscreenSection}
          commentScroll={commentScroll}
          ciScroll={ciScroll}
          conflictScroll={conflictScroll}
          conflictContent={conflictContent}
          conflictContentLoading={conflictContentLoading}
        />
      )}
      {detailMode === "logs" && !fullscreenSection && (
        <LogPane
          entries={branchLogs}
          focused={focusedPane === "sessions"}
          scrollOffset={branchLogOffset}
          visibleLines={branchLogLines}
          label={selectedBranch ? `Logs [${selectedBranch}]` : "Logs"}
        />
      )}
      {showLogs && !fullscreenSection && (
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
          defaultBranch={daemon.getDefaultBranch()}
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
      <HelpBar detailMode={detailMode} fullscreenSection={fullscreenSection} sectionFocus={sectionFocus} />
    </Box>
  );
}
