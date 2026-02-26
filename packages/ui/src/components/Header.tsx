import { useDashboardStore } from "../store";
import { cn } from "../lib/utils";

interface HeaderProps {
  onRefresh: () => void;
}

export function Header({ onRefresh }: HeaderProps) {
  const repo = useDashboardStore((s) => s.repo);
  const connected = useDashboardStore((s) => s.connected);
  const error = useDashboardStore((s) => s.error);
  const branches = useDashboardStore((s) => s.branches);
  const lastUpdated = useDashboardStore((s) => s.lastUpdated);

  const prCount = branches.filter((b) => b.pr).length;
  const activeAgents = branches.filter(
    (b) => b.agent?.status === "running"
  ).length;

  return (
    <>
      <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/80">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-bold tracking-tight text-zinc-100">
            orc
          </h1>
          {repo && (
            <span className="text-xs text-zinc-500">
              {repo.owner}/{repo.repo}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={onRefresh}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1 rounded hover:bg-zinc-800 border border-zinc-700/50"
          >
            Refresh
          </button>

          <div className="flex items-center gap-3 text-xs text-zinc-500">
            {activeAgents > 0 && (
              <span className="text-amber-400">
                {activeAgents} active
              </span>
            )}
            <span>{prCount} PRs</span>
            {lastUpdated && (
              <span>
                next refresh{" "}
                {Math.max(
                  0,
                  30 -
                    Math.floor(
                      (Date.now() - new Date(lastUpdated).getTime()) / 1000
                    )
                )}
                s
              </span>
            )}
          </div>

          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              connected ? "text-emerald-500" : "text-red-500"
            )}
          >
            <span className="text-[8px]">●</span>
            {connected ? "connected" : "disconnected"}
          </div>
        </div>
      </header>

      {error && (
        <div className="px-4 py-1.5 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400">
          {error}
        </div>
      )}
    </>
  );
}
