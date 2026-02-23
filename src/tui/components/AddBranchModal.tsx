import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme.js";
import type { Daemon } from "../../core/daemon.js";
import type { GHPullRequest, PRPage } from "../../github/types.js";
import { logger } from "../../utils/logger.js";

interface AddBranchModalProps {
  daemon: Daemon;
  onClose: () => void;
}

type LoadState = "loading" | "loaded" | "error";

const MAX_VISIBLE = 8;
const DEBOUNCE_MS = 300;

interface CachedPage {
  prs: GHPullRequest[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export function AddBranchModal({ daemon, onClose }: AddBranchModalProps) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageCache, setPageCache] = useState<CachedPage[]>([]);
  const fetchIdRef = useRef(0);
  const targetPageRef = useRef(0);

  // Debounce search input — immediate for empty (browse mode), 300ms for search
  useEffect(() => {
    const delay = query.length === 0 ? 0 : DEBOUNCE_MS;
    const timer = setTimeout(() => setDebouncedQuery(query), delay);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(
    async (searchQuery: string, page: number, cursor: string | null) => {
      const fetchId = ++fetchIdRef.current;
      targetPageRef.current = page;
      setLoadState("loading");

      try {
        const ghClient = daemon.getGHClient();
        let result: PRPage;

        if (searchQuery.length === 0) {
          result = await ghClient.browseOpenPRs(cursor);
        } else {
          result = await ghClient.searchOpenPRs(searchQuery, cursor);
        }

        // Discard result if another fetch started OR user navigated away
        if (fetchIdRef.current !== fetchId || targetPageRef.current !== page) return;

        const cached: CachedPage = {
          prs: result.prs,
          hasNextPage: result.hasNextPage,
          endCursor: result.endCursor,
        };

        setPageCache((prev) => {
          const next = [...prev];
          next[page] = cached;
          return next;
        });
        setCurrentPage(page);
        setSelectedIndex(0);
        setScrollOffset(0);
        setLoadState("loaded");
      } catch (err) {
        // Discard error if another fetch started OR user navigated away
        if (fetchIdRef.current !== fetchId || targetPageRef.current !== page) return;
        logger.error(`Failed to fetch PRs: ${err}`);
        setLoadState("error");
      }
    },
    [daemon],
  );

  // When debounced query changes, reset pagination and fetch page 0
  useEffect(() => {
    setPageCache([]);
    setCurrentPage(0);
    fetchPage(debouncedQuery, 0, null);
  }, [debouncedQuery, fetchPage]);

  // Current page data, filtering out already-tracked branches
  const currentData = pageCache[currentPage] ?? null;
  const discovered = daemon.getDiscoveredPRs();
  const displayPRs =
    currentData?.prs.filter((pr) => !discovered.has(pr.headRefName)) ?? [];

  // Clamp selection when display list changes
  // useLayoutEffect prevents flickering a stale selection before clamping
  useLayoutEffect(() => {
    const max = Math.max(0, displayPRs.length - 1);
    if (selectedIndex > max) {
      setSelectedIndex(max);
      setScrollOffset(Math.max(0, max - MAX_VISIBLE + 1));
    }
  }, [displayPRs.length, selectedIndex]);

  const addBranch = useCallback(
    async (pr: GHPullRequest) => {
      await daemon.addExternalBranch(pr);
      onClose();
    },
    [daemon, onClose],
  );

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return && displayPRs.length > 0) {
      const effectiveIndex = Math.min(selectedIndex, displayPRs.length - 1);
      const pr = displayPRs[effectiveIndex];
      if (pr) {
        addBranch(pr).catch(() => {});
      }
      return;
    }

    // Page navigation with left/right arrows
    if (key.rightArrow) {
      if (currentData?.hasNextPage && currentData.endCursor) {
        const nextPage = currentPage + 1;
        if (pageCache[nextPage]) {
          // Use cached page
          targetPageRef.current = nextPage;
          setCurrentPage(nextPage);
          setSelectedIndex(0);
          setScrollOffset(0);
          setLoadState("loaded");
        } else {
          fetchPage(debouncedQuery, nextPage, currentData.endCursor);
        }
      }
      return;
    }

    if (key.leftArrow) {
      if (currentPage > 0) {
        const prevPage = currentPage - 1;
        targetPageRef.current = prevPage;
        setCurrentPage(prevPage);
        setSelectedIndex(0);
        setScrollOffset(0);
        setLoadState("loaded");
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
        const max = Math.max(0, displayPRs.length - 1);
        const next = Math.min(max, prev + 1);
        if (next >= scrollOffset + MAX_VISIBLE)
          setScrollOffset(next - MAX_VISIBLE + 1);
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

  const visibleItems = displayPRs.slice(
    scrollOffset,
    scrollOffset + MAX_VISIBLE,
  );
  const hasMore = displayPRs.length > scrollOffset + MAX_VISIBLE;
  const hasAbove = scrollOffset > 0;

  const canGoLeft = currentPage > 0;
  const canGoRight = currentData?.hasNextPage ?? false;
  const pageLabel = `Page ${currentPage + 1}`;

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
        <Text color={theme.accent} bold>
          {"Search: "}
        </Text>
        <Text color={theme.text}>{query}</Text>
        <Text color={theme.accent}>{"█"}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {loadState === "loading" && (
          <Text color={theme.muted}>
            {query.length > 0
              ? "Searching open pull requests..."
              : "Fetching open pull requests..."}
          </Text>
        )}

        {loadState === "error" && (
          <Text color={theme.error}>
            Failed to fetch pull requests. Press Esc to close.
          </Text>
        )}

        {loadState === "loaded" && displayPRs.length === 0 && (
          <Text color={theme.muted}>
            {query.length > 0
              ? "No matching pull requests."
              : "No other open pull requests found."}
          </Text>
        )}

        {loadState === "loaded" && displayPRs.length > 0 && (
          <>
            {hasAbove && (
              <Text color={theme.muted} dimColor>
                {"  ↑ "}
                {scrollOffset}
                {" more"}
              </Text>
            )}
            {visibleItems.map((pr, i) => {
              const actualIndex = i + scrollOffset;
              const selected = actualIndex === selectedIndex;
              return (
                <Box key={pr.number}>
                  <Text color={selected ? theme.accent : theme.muted}>
                    {selected ? " ▸ " : "   "}
                  </Text>
                  <Text
                    color={selected ? theme.text : theme.muted}
                    bold={selected}
                  >
                    {pr.headRefName}
                  </Text>
                  <Text dimColor color={theme.muted}>
                    {`  #${pr.number} ${pr.author?.login ?? "ghost"}`}
                  </Text>
                </Box>
              );
            })}
            {hasMore && (
              <Text color={theme.muted} dimColor>
                {"  ↓ "}
                {displayPRs.length - scrollOffset - MAX_VISIBLE}
                {" more"}
              </Text>
            )}
          </>
        )}
      </Box>

      {/* Page indicator */}
      {loadState === "loaded" && (
        <Box marginTop={1} justifyContent="center">
          <Text color={theme.muted}>
            {canGoLeft && (
              <Text color={theme.accent}>{"← "}</Text>
            )}
            <Text dimColor>{pageLabel}</Text>
            {canGoRight && (
              <Text color={theme.accent}>{" →"}</Text>
            )}
          </Text>
        </Box>
      )}

      <Box marginTop={1} justifyContent="center">
        <Text dimColor>
          <Text color={theme.accent}>↑/↓</Text> select{"  "}
          <Text color={theme.accent}>←/→</Text> page{"  "}
          <Text color={theme.accent}>enter</Text> add{"  "}
          <Text color={theme.accent}>esc</Text> cancel
        </Text>
      </Box>
    </Box>
  );
}
