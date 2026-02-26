import { useDashboardStore } from "../store";

export function Footer() {
  const branches = useDashboardStore((s) => s.branches);
  const lastUpdated = useDashboardStore((s) => s.lastUpdated);

  const prCount = branches.filter((b) => b.pr).length;

  return (
    <footer className="flex items-center justify-between px-4 py-1.5 border-t border-zinc-800 bg-zinc-900/80 text-[11px] text-zinc-600">
      <div className="flex items-center gap-4">
        <span>
          {prCount} open PR{prCount !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Shortcut keys="click" action="details" />
        <Shortcut keys="esc" action="close" />
        <Shortcut keys="r" action="refresh" />
      </div>
      {lastUpdated && (
        <span>
          Last sync: {new Date(lastUpdated).toLocaleTimeString()}
        </span>
      )}
    </footer>
  );
}

function Shortcut({ keys, action }: { keys: string; action: string }) {
  return (
    <span>
      <span className="text-zinc-500 bg-zinc-800 rounded px-1 py-0.5 mr-1">
        {keys}
      </span>
      {action}
    </span>
  );
}
