import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme.js";
import { fuzzyFilter } from "../../utils/fuzzy.js";
import type { Daemon } from "../../core/daemon.js";
import type { GHPullRequest } from "../../github/types.js";
import { logger } from "../../utils/logger.js";

interface AddBranchModalProps {
  daemon: Daemon;
  onClose: () => void;
}

type LoadState = "loading" | "loaded" | "error";

const MAX_VISIBLE = 8;

export function AddBranchModal({ daemon, onClose }: AddBranchModalProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [allPRs, setAllPRs] = useState<GHPullRequest[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Fetch all open PRs on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ghClient = daemon.getGHClient();
        const prs = await ghClient.getAllOpenPRs();
        if (cancelled) return;

        // Filter out branches already tracked
        const discovered = daemon.getDiscoveredPRs();
        const filtered = prs.filter((pr) => !discovered.has(pr.headRefName));
        setAllPRs(filtered);
        setLoadState("loaded");
      } catch (err) {
        if (cancelled) return;
        logger.error(`Failed to fetch open PRs: ${err}`);
        setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [daemon]);

  // Fuzzy-filtered results
  const branchNames = allPRs.map((pr) => pr.headRefName);
  const filtered = fuzzyFilter(query, branchNames);
  const prByBranch = new Map(allPRs.map((pr) => [pr.headRefName, pr]));

  // Clamp selection when filtered list changes
  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
  if (clampedIndex !== selectedIndex) {
    // Can't call setState in render, so we handle this in the effect below
  }

  useEffect(() => {
    const max = Math.max(0, filtered.length - 1);
    if (selectedIndex > max) {
      setSelectedIndex(max);
      setScrollOffset(Math.max(0, max - MAX_VISIBLE + 1));
    }
  }, [filtered.length, selectedIndex]);

  const addBranch = useCallback(
    async (branch: string) => {
      const pr = prByBranch.get(branch);
      if (!pr) return;
      await daemon.addExternalBranch(pr);
      onClose();
    },
    [daemon, onClose, prByBranch],
  );

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return && filtered.length > 0) {
      const effectiveIndex = Math.min(clampedIndex, filtered.length - 1);
      const branch = filtered[effectiveIndex];
      if (branch) {
        addBranch(branch).catch(() => {});
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => {
        const next = Math.max(0, prev - 1);
        if (next < scrollOffset) setScrollOffset(next);
        return next;
      });
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => {
        const max = Math.max(0, filtered.length - 1);
        const next = Math.min(max, prev + 1);
        if (next >= scrollOffset + MAX_VISIBLE) setScrollOffset(next - MAX_VISIBLE + 1);
        return next;
      });
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
      setSelectedIndex(0);
      setScrollOffset(0);
      return;
    }

    // Printable character — append to query
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
      setQuery((prev) => prev + input);
      setSelectedIndex(0);
      setScrollOffset(0);
      return;
    }
  });

  const visibleItems = filtered.slice(scrollOffset, scrollOffset + MAX_VISIBLE);
  const hasMore = filtered.length > scrollOffset + MAX_VISIBLE;
  const hasAbove = scrollOffset > 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={2}
      paddingY={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text color={theme.accent} bold>
          {"━━ Add Branch ━━"}
        </Text>
      </Box>

      {/* Search input */}
      <Box>
        <Text color={theme.accent} bold>{"Search: "}</Text>
        <Text color={theme.text}>{query}</Text>
        <Text color={theme.accent}>{"█"}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {loadState === "loading" && (
          <Text color={theme.muted}>Fetching open pull requests...</Text>
        )}

        {loadState === "error" && (
          <Text color={theme.error}>Failed to fetch pull requests. Press Esc to close.</Text>
        )}

        {loadState === "loaded" && allPRs.length === 0 && (
          <Text color={theme.muted}>No other open pull requests found.</Text>
        )}

        {loadState === "loaded" && allPRs.length > 0 && filtered.length === 0 && (
          <Text color={theme.muted}>No matching branches.</Text>
        )}

        {loadState === "loaded" && filtered.length > 0 && (
          <>
            {hasAbove && (
              <Text color={theme.muted} dimColor>  ↑ {scrollOffset} more</Text>
            )}
            {visibleItems.map((branch, i) => {
              const actualIndex = i + scrollOffset;
              const selected = actualIndex === clampedIndex;
              const pr = prByBranch.get(branch);
              return (
                <Box key={branch}>
                  <Text color={selected ? theme.accent : theme.muted}>
                    {selected ? " ▸ " : "   "}
                  </Text>
                  <Text color={selected ? theme.text : theme.muted} bold={selected}>
                    {branch}
                  </Text>
                  {pr && (
                    <Text dimColor color={theme.muted}>
                      {`  #${pr.number} ${pr.author.login}`}
                    </Text>
                  )}
                </Box>
              );
            })}
            {hasMore && (
              <Text color={theme.muted} dimColor>  ↓ {filtered.length - scrollOffset - MAX_VISIBLE} more</Text>
            )}
          </>
        )}
      </Box>

      <Box marginTop={1} justifyContent="center">
        <Text dimColor>
          <Text color={theme.accent}>↑/↓</Text> select  <Text color={theme.accent}>enter</Text> add  <Text color={theme.accent}>esc</Text> cancel
        </Text>
      </Box>
    </Box>
  );
}
