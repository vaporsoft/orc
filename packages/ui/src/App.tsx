import { useWebSocket } from "./hooks/useWebSocket";
import { Layout } from "./components/Layout";
import { BranchList } from "./components/BranchList";
import { DetailPane } from "./components/DetailPane";

export function App() {
  const { sendRefresh, fetchThreads, markThread } = useWebSocket();

  return (
    <Layout
      sidebar={<BranchList />}
      main={
        <DetailPane
          fetchThreads={fetchThreads}
          markThread={markThread}
        />
      }
      onRefresh={sendRefresh}
    />
  );
}
