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

  const withPR = branches.filter((b) => b.pr);
  const withoutPR = branches.filter((b) => !b.pr);

  return (
    <div className="h-full overflow-y-auto">
      {/* Open PRs section */}
      {withPR.length > 0 && (
        <section>
          <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Open Branches
            </span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-zinc-600 border-b border-zinc-800/50">
                <th className="text-left py-1.5 px-4 font-medium">Branch</th>
                <th className="text-left py-1.5 px-2 font-medium w-16">PR</th>
                <th className="text-left py-1.5 px-2 font-medium w-20">Status</th>
                <th className="text-center py-1.5 px-2 font-medium w-12">CI</th>
                <th className="text-center py-1.5 px-2 font-medium w-24">Comments</th>
                <th className="text-center py-1.5 px-2 font-medium w-24">Resolved</th>
                <th className="text-right py-1.5 px-4 font-medium w-24">Updated</th>
              </tr>
            </thead>
            <tbody>
              {withPR.map((branch) => (
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
        </section>
      )}

      {/* Local branches without PRs */}
      {withoutPR.length > 0 && (
        <section>
          <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 mt-0">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Local Branches
            </span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-zinc-600 border-b border-zinc-800/50">
                <th className="text-left py-1.5 px-4 font-medium">Branch</th>
                <th className="text-left py-1.5 px-2 font-medium w-16">PR</th>
                <th className="text-left py-1.5 px-2 font-medium w-20">Status</th>
                <th className="text-center py-1.5 px-2 font-medium w-12">CI</th>
                <th className="text-center py-1.5 px-2 font-medium w-24">Comments</th>
                <th className="text-center py-1.5 px-2 font-medium w-24">Resolved</th>
                <th className="text-right py-1.5 px-4 font-medium w-24">Updated</th>
              </tr>
            </thead>
            <tbody>
              {withoutPR.map((branch) => (
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
        </section>
      )}

      {branches.length === 0 && (
        <div className="flex items-center justify-center h-full text-zinc-600">
          <p>No branches found</p>
        </div>
      )}
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
  const pr = branch.pr;
  const agent = branch.agent;

  const agentLabel = agent?.status === "running"
    ? "running"
    : agent?.status === "error"
      ? "error"
      : pr
        ? "ready"
        : "—";

  const agentColor = agent?.status === "running"
    ? "text-amber-400"
    : agent?.status === "error"
      ? "text-red-400"
      : pr
        ? "text-emerald-400"
        : "text-zinc-600";

  const ciIcon = pr?.checksState === "success"
    ? "✓"
    : pr?.checksState === "failure"
      ? "✗"
      : pr?.checksState === "pending"
        ? "○"
        : "—";

  const ciColor = pr?.checksState === "success"
    ? "text-emerald-400"
    : pr?.checksState === "failure"
      ? "text-red-400"
      : pr?.checksState === "pending"
        ? "text-yellow-400"
        : "text-zinc-600";

  const commentCount = pr?.commentCount ?? 0;
  const threadCount = pr?.threadCount ?? 0;
  const resolvedCount = pr?.resolvedCount ?? 0;
  const addressedCount = pr?.addressedCount ?? 0;
  const totalHandled = resolvedCount + addressedCount;

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
      </td>

      {/* PR number */}
      <td className="py-2 px-2 text-zinc-500">
        {pr ? (
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            #{pr.number}
          </a>
        ) : (
          "—"
        )}
      </td>

      {/* Status */}
      <td className="py-2 px-2">
        <span className={cn("text-xs", agentColor)}>{agentLabel}</span>
      </td>

      {/* CI */}
      <td className="py-2 px-2 text-center">
        <span className={cn(ciColor)}>{ciIcon}</span>
      </td>

      {/* Comments */}
      <td className="py-2 px-2 text-center">
        {commentCount > 0 ? (
          <span
            className={cn(
              "text-xs",
              commentCount > 0 ? "text-zinc-300" : "text-zinc-600"
            )}
          >
            {commentCount}
          </span>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </td>

      {/* Resolved */}
      <td className="py-2 px-2 text-center">
        {threadCount > 0 ? (
          <span
            className={cn(
              "text-xs",
              totalHandled === threadCount
                ? "text-emerald-400"
                : totalHandled > 0
                  ? "text-yellow-400"
                  : "text-zinc-400"
            )}
          >
            {totalHandled}/{threadCount}
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
