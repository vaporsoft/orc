import type { ReactNode } from "react";
import { useDashboardStore } from "../store";
import { cn } from "../lib/utils";

interface LayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  onRefresh: () => void;
}

export function Layout({ sidebar, main, onRefresh }: LayoutProps) {
  const repo = useDashboardStore((s) => s.repo);
  const connected = useDashboardStore((s) => s.connected);
  const error = useDashboardStore((s) => s.error);
  const lastUpdated = useDashboardStore((s) => s.lastUpdated);
  const branches = useDashboardStore((s) => s.branches);

  const prCount = branches.filter((b) => b.pr).length;

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-tight">orc</h1>
          {repo && (
            <span className="text-xs text-zinc-500 font-mono">
              {repo.owner}/{repo.repo}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              connected ? "text-emerald-500" : "text-red-500"
            )}
          >
            <span className="text-[8px]">●</span>
            {connected ? "Connected" : "Disconnected"}
          </div>
          <button
            onClick={onRefresh}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 border-r border-zinc-800 flex-shrink-0 overflow-hidden">
          {sidebar}
        </aside>

        {/* Detail pane */}
        <main className="flex-1 overflow-hidden">{main}</main>
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between px-4 py-1.5 border-t border-zinc-800 text-xs text-zinc-600">
        <span>
          {branches.length} branches · {prCount} open PRs
        </span>
        {lastUpdated && (
          <span>
            Last sync:{" "}
            {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        )}
      </footer>
    </div>
  );
}
