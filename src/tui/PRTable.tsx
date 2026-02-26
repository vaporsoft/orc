import React from "react";
import { Box, Text } from "ink";
import type { Branch, MergedPR } from "../types";

interface PRTableProps {
  branches: Branch[];
  recentlyMerged: MergedPR[];
  selectedIdx: number;
}

export function PRTable({ branches, recentlyMerged, selectedIdx }: PRTableProps) {
  return (
    <Box flexDirection="column">
      {/* Section: Open PRs */}
      <Box marginBottom={1}>
        <Text dimColor bold>
          OPEN PRS
        </Text>
        <Text dimColor> ({branches.length})</Text>
      </Box>

      {branches.length === 0 ? (
        <Text dimColor> No open PRs found</Text>
      ) : (
        <Box flexDirection="column">
          {/* Column headers */}
          <Box>
            <Box width={2}>
              <Text> </Text>
            </Box>
            <Box width={32}>
              <Text dimColor bold>
                Branch
              </Text>
            </Box>
            <Box width={12}>
              <Text dimColor bold>
                Review
              </Text>
            </Box>
            <Box width={6}>
              <Text dimColor bold>
                CI
              </Text>
            </Box>
            <Box width={10}>
              <Text dimColor bold>
                Comments
              </Text>
            </Box>
            <Box width={10}>
              <Text dimColor bold>
                Threads
              </Text>
            </Box>
          </Box>

          {branches.map((branch, idx) => (
            <PRRow
              key={branch.name}
              branch={branch}
              isSelected={idx === selectedIdx}
            />
          ))}
        </Box>
      )}

      {/* Section: Recently Merged */}
      {recentlyMerged.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box marginBottom={1}>
            <Text dimColor bold>
              RECENTLY MERGED
            </Text>
            <Text dimColor> ({recentlyMerged.length})</Text>
          </Box>
          {recentlyMerged.map((pr) => (
            <MergedRow key={pr.number} pr={pr} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function PRRow({
  branch,
  isSelected,
}: {
  branch: Branch;
  isSelected: boolean;
}) {
  const pr = branch.pr!;

  const reviewLabel =
    pr.reviewState === "changes_requested" ? "changes" : pr.reviewState;
  const reviewColor =
    pr.reviewState === "approved"
      ? "green"
      : pr.reviewState === "changes_requested"
        ? "red"
        : pr.reviewState === "pending"
          ? "yellow"
          : "gray";

  const ciIcon =
    pr.checksState === "success"
      ? "✓"
      : pr.checksState === "failure"
        ? "✗"
        : pr.checksState === "pending"
          ? "○"
          : "—";
  const ciColor =
    pr.checksState === "success"
      ? "green"
      : pr.checksState === "failure"
        ? "red"
        : pr.checksState === "pending"
          ? "yellow"
          : "gray";

  const totalHandled = pr.resolvedCount + pr.addressedCount;
  const threadText =
    pr.threadCount > 0 ? `${totalHandled}/${pr.threadCount}` : "—";
  const threadColor =
    pr.threadCount === 0
      ? "gray"
      : totalHandled === pr.threadCount
        ? "green"
        : totalHandled > 0
          ? "yellow"
          : undefined;

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={2}>
          <Text color={isSelected ? "blue" : undefined}>
            {isSelected ? ">" : " "}
          </Text>
        </Box>
        <Box width={32}>
          <Text color={isSelected ? "white" : undefined} bold={isSelected}>
            {branch.isHead ? "* " : ""}
            {branch.name}
          </Text>
        </Box>
        <Box width={12}>
          <Text color={reviewColor}>{reviewLabel}</Text>
        </Box>
        <Box width={6}>
          <Text color={ciColor}>{ciIcon}</Text>
        </Box>
        <Box width={10}>
          <Text>{pr.commentCount > 0 ? String(pr.commentCount) : "—"}</Text>
        </Box>
        <Box width={10}>
          <Text color={threadColor}>{threadText}</Text>
        </Box>
      </Box>
      <Box>
        <Box width={2}>
          <Text> </Text>
        </Box>
        <Text dimColor>
          {"  "}#{pr.number} · {pr.title}
        </Text>
      </Box>
    </Box>
  );
}

function MergedRow({ pr }: { pr: MergedPR }) {
  const ago = getTimeAgo(pr.mergedAt);
  return (
    <Box>
      <Box width={2}>
        <Text> </Text>
      </Box>
      <Text color="magenta" dimColor>
        {"✓ "}
      </Text>
      <Box width={28}>
        <Text dimColor>{pr.headRefName}</Text>
      </Box>
      <Text dimColor>
        #{pr.number} {pr.author} {ago}
      </Text>
    </Box>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
