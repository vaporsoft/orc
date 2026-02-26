import { useEffect } from "react";
import { useDashboardStore } from "../store";
import { ThreadList } from "./ThreadList";
import { cn } from "../lib/utils";
import type { DispositionKind } from "../types";

interface DetailOverlayProps {
  fetchThreads: (prNumber: number) => void;
  markThread: (
    prNumber: number,
    threadId: string,
    disposition: DispositionKind
  ) => void;
}

export function DetailOverlay({
  fetchThreads,
  markThread,
}: DetailOverlayProps) {
  const branches = useDashboardStore((s) => s.branches);
  const selectedBranch = useDashboardStore((s) => s.selectedBranch);
  const selectBranch = useDashboardStore((s) => s.selectBranch);

  const branch = branches.find((b) => b.name === selectedBranch);
  const prNumber = branch?.pr?.number;

  useEffect(() => {
    if (prNumber) {
      fetchThreads(prNumber);
    }
  }, [prNumber, fetchThreads]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectBranch(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectBranch]);

  if (!branch) return null;

  const pr = branch.pr;

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 z-10"
        onClick={() => selectBranch(null)}
      />

      {/* Panel */}
      <div className="absolute top-0 right-0 bottom-0 w-[560px] max-w-full bg-zinc-950 border-l border-zinc-800 z-20 flex flex-col overflow-hidden">
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100 truncate">
              {branch.name}
            </h2>
            {pr && (
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                #{pr.number}: {pr.title} ↗
              </a>
            )}
          </div>
          <button
            onClick={() => selectBranch(null)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded hover:bg-zinc-800 text-xs"
          >
            esc
          </button>
        </div>

        {/* PR Status row */}
        {pr && (
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-4 text-xs">
            <StatusPill
              label="Review"
              value={formatReviewState(pr.reviewState)}
              color={reviewColor(pr.reviewState)}
            />
            <StatusPill
              label="CI"
              value={pr.checksState}
              color={checksColor(pr.checksState)}
            />
            <StatusPill
              label="Comments"
              value={String(pr.commentCount)}
              color={pr.commentCount > 0 ? "text-zinc-300" : "text-zinc-600"}
            />
            {pr.threadCount > 0 && (
              <StatusPill
                label="Resolved"
                value={`${pr.resolvedCount + pr.addressedCount}/${pr.threadCount}`}
                color={
                  pr.resolvedCount + pr.addressedCount === pr.threadCount
                    ? "text-emerald-400"
                    : "text-yellow-400"
                }
              />
            )}
          </div>
        )}

        {/* Agent status */}
        {branch.agent?.status === "running" && (
          <div className="px-4 py-2 border-b border-zinc-800 text-xs text-amber-400">
            <span className="animate-pulse">⚡</span>{" "}
            {branch.agent.currentTask || "Agent running..."}
          </div>
        )}

        {/* Thread list — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {pr ? (
            <ThreadList
              prNumber={pr.number}
              onMark={markThread}
              onRefresh={() => fetchThreads(pr.number)}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-600 text-xs">
              No PR associated with this branch
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StatusPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-zinc-600">{label}:</span>
      <span className={color}>{value}</span>
    </div>
  );
}

function formatReviewState(
  state: "approved" | "changes_requested" | "pending" | "none"
): string {
  switch (state) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes";
    case "pending":
      return "pending";
    default:
      return "none";
  }
}

function reviewColor(
  state: "approved" | "changes_requested" | "pending" | "none"
): string {
  switch (state) {
    case "approved":
      return "text-emerald-400";
    case "changes_requested":
      return "text-red-400";
    case "pending":
      return "text-yellow-400";
    default:
      return "text-zinc-600";
  }
}

function checksColor(
  state: "success" | "failure" | "pending" | "none"
): string {
  switch (state) {
    case "success":
      return "text-emerald-400";
    case "failure":
      return "text-red-400";
    case "pending":
      return "text-yellow-400";
    default:
      return "text-zinc-600";
  }
}
