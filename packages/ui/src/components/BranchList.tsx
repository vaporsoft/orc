import { useDashboardStore } from "../store";
import { BranchItem } from "./BranchItem";

export function BranchList() {
  const branches = useDashboardStore((s) => s.branches);
  const selectedBranch = useDashboardStore((s) => s.selectedBranch);
  const selectBranch = useDashboardStore((s) => s.selectBranch);

  const withPR = branches.filter((b) => b.pr);
  const withoutPR = branches.filter((b) => !b.pr);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Branches
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {branches.length === 0 && (
          <p className="text-sm text-zinc-600 px-3 py-4">
            No branches found
          </p>
        )}

        {/* Branches with open PRs first */}
        {withPR.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 px-3 pt-2 pb-1">
              Open PRs
            </p>
            {withPR.map((branch) => (
              <BranchItem
                key={branch.name}
                branch={branch}
                isSelected={selectedBranch === branch.name}
                onClick={() =>
                  selectBranch(
                    selectedBranch === branch.name ? null : branch.name
                  )
                }
              />
            ))}
          </>
        )}

        {/* Other branches */}
        {withoutPR.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 px-3 pt-3 pb-1">
              Local
            </p>
            {withoutPR.map((branch) => (
              <BranchItem
                key={branch.name}
                branch={branch}
                isSelected={selectedBranch === branch.name}
                onClick={() =>
                  selectBranch(
                    selectedBranch === branch.name ? null : branch.name
                  )
                }
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
