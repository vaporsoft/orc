import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { RepoInfo } from "../types";

interface HeaderProps {
  repo: RepoInfo;
  prCount: number;
  lastRefresh: Date;
  loading: boolean;
  error: string | null;
  width: number;
}

export function Header({ repo, prCount, lastRefresh, loading, error, width }: HeaderProps) {
  const [, setTick] = useState(0);

  // Tick every second to update countdown
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const secondsAgo = Math.floor((Date.now() - lastRefresh.getTime()) / 1000);
  const nextRefresh = Math.max(0, 30 - secondsAgo);

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" width={width}>
        <Box gap={2}>
          <Text bold color="white">orc</Text>
          <Text dimColor>
            {repo.owner}/{repo.repo}
          </Text>
        </Box>
        <Box gap={2}>
          <Text dimColor>
            {prCount} PR{prCount !== 1 ? "s" : ""}
          </Text>
          {loading ? (
            <Text color="yellow">refreshing...</Text>
          ) : (
            <Text dimColor>next refresh {nextRefresh}s</Text>
          )}
        </Box>
      </Box>
      {error && <Text color="red">{error}</Text>}
      <Text dimColor>{"─".repeat(width)}</Text>
    </Box>
  );
}
