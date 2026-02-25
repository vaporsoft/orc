import { cn } from "../lib/utils";
import { ChecksIndicator } from "./StatusBadge";
import type { Branch } from "../types";

interface BranchItemProps {
  branch: Branch;
  isSelected: boolean;
  onClick: () => void;
}

export function BranchItem({ branch, isSelected, onClick }: BranchItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-lg transition-colors",
        "hover:bg-zinc-800/60",
        isSelected && "bg-zinc-800 ring-1 ring-zinc-700"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* CI status dot */}
        {branch.pr && (
          <ChecksIndicator state={branch.pr.checksState} />
        )}
        {!branch.pr && <span className="text-xs text-zinc-700">●</span>}

        {/* Branch name */}
        <span
          className={cn(
            "text-sm font-mono truncate",
            branch.isHead ? "text-zinc-100" : "text-zinc-300"
          )}
        >
          {branch.isHead && (
            <span className="text-blue-400 mr-1">*</span>
          )}
          {branch.name}
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Agent status */}
        {branch.agent?.status === "running" && (
          <span className="text-xs text-amber-400 animate-pulse">⚡</span>
        )}

        {/* Comment count badge */}
        {branch.pr && branch.pr.commentCount > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300 min-w-[1.25rem]">
            {branch.pr.commentCount}
          </span>
        )}
      </div>

      {/* PR title subtitle */}
      {branch.pr && (
        <p className="mt-1 text-xs text-zinc-500 truncate pl-5">
          #{branch.pr.number} {branch.pr.title}
        </p>
      )}
    </button>
  );
}
