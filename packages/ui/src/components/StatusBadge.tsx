import { cn } from "../lib/utils";

type ReviewState = "approved" | "changes_requested" | "pending" | "none";
type ChecksState = "success" | "failure" | "pending" | "none";

const reviewConfig: Record<ReviewState, { label: string; className: string }> =
  {
    approved: {
      label: "Approved",
      className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    },
    changes_requested: {
      label: "Changes",
      className: "bg-red-500/15 text-red-400 border-red-500/25",
    },
    pending: {
      label: "Review",
      className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
    },
    none: {
      label: "No review",
      className: "bg-zinc-500/15 text-zinc-500 border-zinc-500/25",
    },
  };

const checksConfig: Record<ChecksState, { icon: string; className: string }> = {
  success: { icon: "●", className: "text-emerald-400" },
  failure: { icon: "●", className: "text-red-400" },
  pending: { icon: "●", className: "text-yellow-400" },
  none: { icon: "●", className: "text-zinc-600" },
};

export function ReviewBadge({ state }: { state: ReviewState }) {
  const config = reviewConfig[state];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium",
        config.className
      )}
    >
      {config.label}
    </span>
  );
}

export function ChecksIndicator({ state }: { state: ChecksState }) {
  const config = checksConfig[state];
  return (
    <span className={cn("text-xs", config.className)} title={`CI: ${state}`}>
      {config.icon}
    </span>
  );
}
