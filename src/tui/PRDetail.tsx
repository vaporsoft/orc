import React from "react";
import { Box, Text } from "ink";
import type { Branch, ReviewThread, ThreadDisposition } from "../types";

interface PRDetailProps {
  branch: Branch;
  threads: ReviewThread[];
  dispositions: Record<string, ThreadDisposition>;
  width: number;
}

export function PRDetail({ branch, threads, dispositions, width }: PRDetailProps) {
  const pr = branch.pr;
  if (!pr) {
    return <Text dimColor>No PR associated with this branch</Text>;
  }

  const unresolvedThreads = threads.filter((t) => !t.isResolved);
  const resolvedThreads = threads.filter((t) => t.isResolved);
  const actionable = unresolvedThreads.filter((t) => !dispositions[t.id]);
  const addressed = unresolvedThreads.filter((t) => dispositions[t.id]);

  const reviewColor =
    pr.reviewState === "approved"
      ? "green"
      : pr.reviewState === "changes_requested"
        ? "red"
        : pr.reviewState === "pending"
          ? "yellow"
          : "gray";
  const ciColor =
    pr.checksState === "success"
      ? "green"
      : pr.checksState === "failure"
        ? "red"
        : pr.checksState === "pending"
          ? "yellow"
          : "gray";

  return (
    <Box flexDirection="column">
      {/* PR header */}
      <Box gap={2}>
        <Text bold>{branch.name}</Text>
        <Text dimColor>
          #{pr.number}: {pr.title}
        </Text>
      </Box>

      {/* Status row */}
      <Box gap={3}>
        <Box gap={1}>
          <Text dimColor>Review:</Text>
          <Text color={reviewColor}>
            {pr.reviewState === "changes_requested" ? "changes" : pr.reviewState}
          </Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>CI:</Text>
          <Text color={ciColor}>{pr.checksState}</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>Comments:</Text>
          <Text>{pr.commentCount}</Text>
        </Box>
        {pr.threadCount > 0 && (
          <Box gap={1}>
            <Text dimColor>Threads:</Text>
            <Text
              color={
                pr.resolvedCount + pr.addressedCount === pr.threadCount
                  ? "green"
                  : "yellow"
              }
            >
              {pr.resolvedCount + pr.addressedCount}/{pr.threadCount}
            </Text>
          </Box>
        )}
      </Box>

      <Text dimColor>{"─".repeat(width)}</Text>

      {/* Thread sections */}
      {threads.length === 0 && <Text dimColor>Loading threads...</Text>}

      {actionable.length > 0 && (
        <ThreadSection
          title="ACTIONABLE"
          count={actionable.length}
          threads={actionable}
          dispositions={dispositions}
        />
      )}

      {addressed.length > 0 && (
        <ThreadSection
          title="ADDRESSED"
          count={addressed.length}
          threads={addressed}
          dispositions={dispositions}
        />
      )}

      {resolvedThreads.length > 0 && (
        <ThreadSection
          title="RESOLVED"
          count={resolvedThreads.length}
          threads={resolvedThreads}
          dispositions={dispositions}
        />
      )}
    </Box>
  );
}

function ThreadSection({
  title,
  count,
  threads,
  dispositions,
}: {
  title: string;
  count: number;
  threads: ReviewThread[];
  dispositions: Record<string, ThreadDisposition>;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor bold>
        {title} ({count})
      </Text>
      {threads.map((thread) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          disposition={dispositions[thread.id]}
        />
      ))}
    </Box>
  );
}

const DISPOSITION_COLORS: Record<string, string> = {
  fixed: "green",
  skipped: "gray",
  errored: "red",
  no_change: "gray",
  clarification: "yellow",
  addressed: "blue",
};

function ThreadItem({
  thread,
  disposition,
}: {
  thread: ReviewThread;
  disposition?: ThreadDisposition;
}) {
  const firstComment = thread.comments[0];
  if (!firstComment) return null;

  const body = firstComment.body.split("\n")[0] ?? "";
  const truncated = body.length > 120 ? body.slice(0, 120) + "..." : body;

  return (
    <Box flexDirection="column" marginLeft={2}>
      {thread.path && (
        <Box gap={1}>
          <Text color="cyan">
            {thread.path}
            {thread.line ? `:${thread.line}` : ""}
          </Text>
          {thread.isResolved && <Text color="green">{"✓"}</Text>}
          {disposition && (
            <Text color={DISPOSITION_COLORS[disposition.disposition] ?? "gray"}>
              [{disposition.disposition}
              {disposition.attempts > 1 ? ` x${disposition.attempts}` : ""}]
            </Text>
          )}
        </Box>
      )}
      <Box marginLeft={2}>
        <Text>
          <Text dimColor>@{firstComment.author}:</Text> {truncated}
        </Text>
      </Box>
      {thread.comments.length > 1 && (
        <Box marginLeft={2}>
          <Text dimColor>
            +{thread.comments.length - 1}{" "}
            {thread.comments.length - 1 === 1 ? "reply" : "replies"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
