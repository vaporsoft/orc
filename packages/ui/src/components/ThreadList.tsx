import { useDashboardStore } from "../store";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/utils";
import type { ReviewThread, ThreadDisposition, DispositionKind } from "../types";

interface ThreadListProps {
  prNumber: number;
  onMark: (prNumber: number, threadId: string, disposition: DispositionKind) => void;
  onRefresh: () => void;
}

const dispositionLabels: Record<DispositionKind, string> = {
  fixed: "Fixed",
  skipped: "Skipped",
  errored: "Errored",
  no_change: "No change",
  clarification: "Needs clarification",
  addressed: "Addressed",
};

const dispositionColors: Record<DispositionKind, string> = {
  fixed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  skipped: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
  errored: "bg-red-500/15 text-red-400 border-red-500/25",
  no_change: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
  clarification: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  addressed: "bg-blue-500/15 text-blue-400 border-blue-500/25",
};

export function ThreadList({ prNumber, onMark, onRefresh }: ThreadListProps) {
  const threads = useDashboardStore((s) => s.threadsByPR[prNumber]) ?? [];
  const dispositions =
    useDashboardStore((s) => s.dispositionsByPR[prNumber]) ?? {};
  const loading = useDashboardStore((s) => s.threadsLoading === prNumber);

  const unresolvedThreads = threads.filter((t) => !t.isResolved);
  const resolvedThreads = threads.filter((t) => t.isResolved);

  // Split unresolved into actionable vs locally addressed
  const actionable = unresolvedThreads.filter((t) => !dispositions[t.id]);
  const addressed = unresolvedThreads.filter((t) => dispositions[t.id]);

  return (
    <div className="px-6 py-4 border-b border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Review Threads
        </h3>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {threads.length === 0 && !loading && (
        <p className="text-sm text-zinc-600">No review threads</p>
      )}

      {loading && threads.length === 0 && (
        <p className="text-sm text-zinc-600 animate-pulse">
          Fetching threads...
        </p>
      )}

      {/* Actionable threads */}
      {actionable.length > 0 && (
        <div className="space-y-2 mb-4">
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">
            Actionable ({actionable.length})
          </p>
          {actionable.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              disposition={dispositions[thread.id]}
              prNumber={prNumber}
              onMark={onMark}
            />
          ))}
        </div>
      )}

      {/* Locally addressed threads */}
      {addressed.length > 0 && (
        <div className="space-y-2 mb-4">
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">
            Addressed ({addressed.length})
          </p>
          {addressed.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              disposition={dispositions[thread.id]}
              prNumber={prNumber}
              onMark={onMark}
            />
          ))}
        </div>
      )}

      {/* Resolved on GitHub */}
      {resolvedThreads.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">
            Resolved ({resolvedThreads.length})
          </p>
          {resolvedThreads.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              disposition={dispositions[thread.id]}
              prNumber={prNumber}
              onMark={onMark}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Thread item ---

interface ThreadItemProps {
  thread: ReviewThread;
  disposition?: ThreadDisposition;
  prNumber: number;
  onMark: (prNumber: number, threadId: string, disposition: DispositionKind) => void;
}

function ThreadItem({ thread, disposition, prNumber, onMark }: ThreadItemProps) {
  const firstComment = thread.comments[0];
  if (!firstComment) return null;

  const isAddressed = !!disposition;
  const latestComment = thread.comments[thread.comments.length - 1];

  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm",
        thread.isResolved
          ? "border-zinc-800/50 opacity-60"
          : isAddressed
            ? "border-zinc-700/50 opacity-75"
            : "border-zinc-700"
      )}
    >
      {/* File path + line */}
      {thread.path && (
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-mono text-zinc-500 truncate">
            {thread.path}
            {thread.line ? `:${thread.line}` : ""}
          </span>
        </div>
      )}

      {/* Comment body (first comment, truncated) */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-zinc-400">
            @{firstComment.author}
          </span>
          <p className="text-zinc-300 mt-0.5 line-clamp-2">
            {firstComment.body}
          </p>
          {thread.comments.length > 1 && (
            <p className="text-xs text-zinc-600 mt-1">
              +{thread.comments.length - 1} more{" "}
              {thread.comments.length - 1 === 1 ? "reply" : "replies"}
              {" · "}
              latest {timeAgo(latestComment.createdAt)}
            </p>
          )}
        </div>
      </div>

      {/* Disposition badge + actions */}
      <div className="flex items-center gap-2 mt-2">
        {disposition && (
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium",
              dispositionColors[disposition.disposition]
            )}
          >
            {dispositionLabels[disposition.disposition]}
            {disposition.attempts > 1 && (
              <span className="ml-1 opacity-70">x{disposition.attempts}</span>
            )}
          </span>
        )}

        {thread.isResolved && (
          <span className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium bg-emerald-500/15 text-emerald-400 border-emerald-500/25">
            Resolved
          </span>
        )}

        <span className="flex-1" />

        {/* Mark as addressed button */}
        {!thread.isResolved && !isAddressed && (
          <button
            onClick={() => onMark(prNumber, thread.id, "addressed")}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded hover:bg-zinc-800 border border-transparent hover:border-zinc-700"
          >
            Mark addressed
          </button>
        )}

        {/* Link to GitHub */}
        {firstComment.url && (
          <a
            href={firstComment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            View ↗
          </a>
        )}
      </div>
    </div>
  );
}
