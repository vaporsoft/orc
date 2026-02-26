import { useWebSocket } from "./hooks/useWebSocket";
import { Header } from "./components/Header";
import { BranchTable } from "./components/BranchTable";
import { DetailOverlay } from "./components/DetailOverlay";
import { Footer } from "./components/Footer";
import { useDashboardStore } from "./store";

export function App() {
  const { sendRefresh, fetchThreads, markThread } = useWebSocket();
  const selectedBranch = useDashboardStore((s) => s.selectedBranch);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 font-mono text-sm">
      <Header onRefresh={sendRefresh} />

      <main className="flex-1 overflow-hidden relative">
        <BranchTable onRefresh={sendRefresh} />

        {selectedBranch && (
          <DetailOverlay
            fetchThreads={fetchThreads}
            markThread={markThread}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}
