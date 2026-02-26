import { useDashboardStore } from "../store";
import { cn } from "../lib/utils";
import type { Branch } from "../types";

interface BranchTableProps {
  onRefresh: () => void;
}

export function BranchTable({ onRefresh }: BranchTableProps) {
  const branches = useDashboardStore((s) => s.branches);
  const selectedBranch = useDashboardStore((s) => s.selectedBranch);
  const selectBranch = useDashboardStore((s) => s.selectBranch);

  // Only show branches with open PRs
  const prBranches = branches.filter((b) => b.pr);

  return (
    <div className="h-full overflow-y-auto">
      <section>
        <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
          <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Open Branches
          </span>
          <span className="text-[10px] text-zinc-600 ml-2">
            {prBranches.length}
          </span>
        </div>

        {prBranches.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-zinc-600 border-b border-zinc-800/50">
                <th className="text-left py-1.5 px-4 font-medium">Branch</th>
                <th className="text-left py-1.5 px-2 font-medium w-16">PR</th>
                <th className="text-left py-1.5 px-2 font-medium w-20">Review</th>
                <th className="text-center py-1.5 px-2 font-medium w-12">CI</th>
                <th className="text-center py-1.5 px-2 font-medium w-24">Comments</th>
                <th className="text-center py-1.5 px-2 font-medium w-24">Resolved</th>
                <th className="text-right py-1.5 px-4 font-medium w-24">Updated</th>
              </tr>
            </thead>
            <tbody>
              {prBranches.map((branch) => (
                <BranchRow
                  key={branch.name}
                  branch={branch}
                  isSelected={selectedBranch === branch.name}
                  onSelect={() =>
                    selectBranch(
                      selectedBranch === branch.name ? null : branch.name
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-4 py-8 text-center text-zinc-600 text-xs">
            No open PRs found. Make sure <code className="text-zinc-500">gh</code> is authenticated.
          </div>
        )}
      </section>
    </div>
  );
}

// --- Row component ---

function BranchRow({
  branch,
  isSelected,
  onSelect,
}: {
  branch: Branch;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const pr = branch.pr!; // Only rendered for branches with PRs
  const agent = branch.agent;

  const reviewLabel = pr.reviewState === "changes_requested"
    ? "changes"
    : pr.reviewState;

  const reviewColor = pr.reviewState === "approved"
    ? "text-emerald-400"
    : pr.reviewState === "changes_requested"
      ? "text-red-400"
      : pr.reviewState === "pending"
        ? "text-yellow-400"
        : "text-zinc-600";

  const ciIcon = pr.checksState === "success"
    ? "✓"
    : pr.checksState === "failure"
      ? "✗"
      : pr.checksState === "pending"
        ? "○"
        : "—";

  const ciColor = pr.checksState === "success"
    ? "text-emerald-400"
    : pr.checksState === "failure"
      ? "text-red-400"
      : pr.checksState === "pending"
        ? "text-yellow-400"
        : "text-zinc-600";

  const totalHandled = pr.resolvedCount + pr.addressedCount;

  const updatedTime = new Date(branch.updatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <tr
      onClick={onSelect}
      className={cn(
        "cursor-pointer border-b border-zinc-800/30 transition-colors",
        "hover:bg-zinc-800/40",
        isSelected && "bg-zinc-800/60 border-l-2 border-l-blue-500"
      )}
    >
      {/* Branch name */}
      <td className="py-2 px-4">
        <div className="flex items-center gap-2 min-w-0">
          {branch.isHead && (
            <span className="text-blue-400 text-xs">*</span>
          )}
          <span className="truncate text-zinc-200">{branch.name}</span>
          {agent?.status === "running" && (
            <span className="text-amber-400 animate-pulse text-xs">⚡</span>
          )}
        </div>
        <div className="text-[11px] text-zinc-600 truncate mt-0.5">
          {pr.title}
        </div>
      </td>

      {/* PR number */}
      <td className="py-2 px-2">
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          #{pr.number}
        </a>
      </td>

      {/* Review */}
      <td className="py-2 px-2">
        <span className={cn("text-xs", reviewColor)}>{reviewLabel}</span>
      </td>

      {/* CI */}
      <td className="py-2 px-2 text-center">
        <span className={cn(ciColor)}>{ciIcon}</span>
      </td>

      {/* Comments */}
      <td className="py-2 px-2 text-center">
        {pr.commentCount > 0 ? (
          <span className="text-xs text-zinc-300">{pr.commentCount}</span>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </td>

      {/* Resolved */}
      <td className="py-2 px-2 text-center">
        {pr.threadCount > 0 ? (
          <span
            className={cn(
              "text-xs",
              totalHandled === pr.threadCount
                ? "text-emerald-400"
                : totalHandled > 0
                  ? "text-yellow-400"
                  : "text-zinc-400"
            )}
          >
            {totalHandled}/{pr.threadCount}
          </span>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </td>

      {/* Updated */}
      <td className="py-2 px-4 text-right text-zinc-500 text-xs">
        {updatedTime}
      </td>
    </tr>
  );
}
