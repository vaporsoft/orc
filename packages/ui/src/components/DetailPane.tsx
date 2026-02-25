import { useDashboardStore } from "../store";
import { ReviewBadge, ChecksIndicator } from "./StatusBadge";
import { timeAgo } from "../lib/utils";

export function DetailPane() {
  const branches = useDashboardStore((s) => s.branches);
  const selectedBranch = useDashboardStore((s) => s.selectedBranch);

  const branch = branches.find((b) => b.name === selectedBranch);

  if (!branch) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600">
        <div className="text-center">
          <p className="text-lg">Select a branch</p>
          <p className="text-sm mt-1">Click a branch to see details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold font-mono text-zinc-100">
            {branch.name}
          </h2>
          {branch.isHead && (
            <span className="text-xs bg-blue-500/15 text-blue-400 border border-blue-500/25 rounded-md px-1.5 py-0.5">
              HEAD
            </span>
          )}
        </div>

        {branch.pr && (
          <div className="mt-2">
            <a
              href={branch.pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              #{branch.pr.number}: {branch.pr.title} ↗
            </a>
          </div>
        )}
      </div>

      {/* PR Status */}
      {branch.pr && (
        <div className="px-6 py-4 border-b border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
            Status
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Review:</span>
              <ReviewBadge state={branch.pr.reviewState} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">CI:</span>
              <ChecksIndicator state={branch.pr.checksState} />
              <span className="text-xs text-zinc-400">
                {branch.pr.checksState}
              </span>
            </div>
            {branch.pr.commentCount > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Comments:</span>
                <span className="text-xs text-zinc-300">
                  {branch.pr.commentCount}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent Activity (placeholder for M1) */}
      <div className="px-6 py-4 border-b border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          Agent
        </h3>
        {branch.agent?.status === "running" ? (
          <div className="text-sm text-amber-400">
            <span className="animate-pulse">⚡</span> Running:{" "}
            {branch.agent.currentTask || "working..."}
          </div>
        ) : (
          <p className="text-sm text-zinc-600">No agent active</p>
        )}
      </div>

      {/* Actions (placeholder buttons for M1) */}
      {branch.pr && (
        <div className="px-6 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
            Actions
          </h3>
          <div className="flex gap-2">
            <button
              disabled
              className="px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-500 text-sm border border-zinc-700 cursor-not-allowed"
              title="Coming in Milestone 4"
            >
              Fix Comments
            </button>
            <button
              disabled
              className="px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-500 text-sm border border-zinc-700 cursor-not-allowed"
              title="Coming in Milestone 4"
            >
              Fix CI
            </button>
          </div>
          <p className="text-xs text-zinc-700 mt-2">
            Agent actions available in a future update
          </p>
        </div>
      )}

      {/* Last updated */}
      <div className="px-6 py-3">
        <p className="text-xs text-zinc-700">
          Updated {timeAgo(branch.updatedAt)}
        </p>
      </div>
    </div>
  );
}
