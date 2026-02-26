import { createServer } from "http";
import { join, dirname } from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { BranchStore, type ThreadSummary } from "./state/store";
import { ThreadStore } from "./state/thread-store";
import { GitHubClient, resolveToken } from "./github/client";
import { loadEnv } from "./env";
import { listLocalBranches } from "./git/branches";
import { getRepoRoot, getRepoInfo } from "./git/repo";
import type { ServerMessage, ClientMessage } from "./types";

// Load .env from repo root (before reading any env vars)
await loadEnv();

const PORT = parseInt(process.env.ORC_PORT || "3333");
const REPO_PATH = process.env.ORC_REPO || process.cwd();
const REFRESH_INTERVAL = 30_000; // 30 seconds

// --- Initialize ---

console.log(`orc: detecting repo at ${REPO_PATH}...`);
const repoRoot = await getRepoRoot(REPO_PATH);
const repoInfo = await getRepoInfo(repoRoot);
console.log(`orc: ${repoInfo.owner}/${repoInfo.repo} (default: ${repoInfo.defaultBranch})`);

const token = await resolveToken();
console.log(`orc: GitHub token resolved`);
const github = new GitHubClient(repoInfo.owner, repoInfo.repo, token);
const store = new BranchStore();
store.setRepoInfo(repoInfo);

const threadStore = new ThreadStore();

// --- WebSocket clients ---

const clients = new Set<WebSocket>();

function broadcast(msg: ServerMessage) {
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function sendTo(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// --- Refresh loop ---

async function refresh() {
  try {
    const [branches, prs, recentlyMerged] = await Promise.all([
      listLocalBranches(repoRoot),
      github.listOpenPRs(),
      github.listRecentlyMergedPRs(24).catch(() => []),
    ]);

    console.log(`orc: found ${prs.length} open PR(s), ${recentlyMerged.length} recently merged, ${branches.length} local branch(es)`);

    // Fetch thread summaries for all PRs (best-effort, don't block refresh)
    const threadSummaries = new Map<number, ThreadSummary>();
    try {
      const summaryResults = await Promise.allSettled(
        prs.map(async (pr) => {
          const threads = await github.listReviewThreads(pr.number);
          const dispositions = threadStore.getDispositions(pr.number);
          const resolvedCount = threads.filter((t) => t.isResolved).length;
          const addressedCount = threads.filter(
            (t) => !t.isResolved && dispositions[t.id]
          ).length;
          return {
            prNumber: pr.number,
            summary: {
              threadCount: threads.length,
              resolvedCount,
              addressedCount,
            },
          };
        })
      );
      for (const result of summaryResults) {
        if (result.status === "fulfilled") {
          threadSummaries.set(result.value.prNumber, result.value.summary);
        }
      }
    } catch {
      // Thread fetching is best-effort — table still works without it
    }

    store.update(branches, prs, threadSummaries);
    store.setRecentlyMerged(recentlyMerged);
    store.lastError = null;

    threadStore.pruneClosedPRs(prs.map((pr) => pr.number));

    broadcast({ type: "state", data: store.getState() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`orc: refresh failed: ${message}`);
    store.lastError = message;
    broadcast({ type: "error", message });
  }
}

// --- Thread operations ---

async function fetchAndSendThreads(ws: WebSocket, prNumber: number) {
  try {
    const threads = await github.listReviewThreads(prNumber);
    const dispositions = threadStore.getDispositions(prNumber);
    sendTo(ws, {
      type: "threads",
      data: { prNumber, threads, dispositions },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`orc: failed to fetch threads for PR #${prNumber}: ${message}`);
    sendTo(ws, { type: "error", message: `Failed to fetch threads: ${message}` });
  }
}

async function handleMarkThread(
  ws: WebSocket,
  prNumber: number,
  threadId: string,
  disposition: ClientMessage & { type: "mark_thread" }
) {
  threadStore.markThread(prNumber, threadId, disposition.disposition);
  try {
    const threads = await github.listReviewThreads(prNumber);
    const dispositions = threadStore.getDispositions(prNumber);
    broadcast({
      type: "threads",
      data: { prNumber, threads, dispositions },
    });
  } catch {
    const dispositions = threadStore.getDispositions(prNumber);
    sendTo(ws, {
      type: "threads",
      data: { prNumber, threads: [], dispositions },
    });
  }
}

// Run first refresh
try {
  await refresh();
} catch (err) {
  console.error("orc: initial refresh failed:", err);
}
setInterval(refresh, REFRESH_INTERVAL);

// --- HTTP + WebSocket server ---

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIST = join(__dirname, "../../ui/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function getMime(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  return MIME_TYPES[ext] || "application/octet-stream";
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  const json = (data: unknown, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  const readBody = (): Promise<string> =>
    new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => resolve(body));
    });

  // REST API
  if (url.pathname === "/api/state") {
    return json(store.getState());
  }

  if (url.pathname === "/api/refresh" && req.method === "POST") {
    await refresh();
    return json({ ok: true });
  }

  const threadsMatch = url.pathname.match(/^\/api\/pr\/(\d+)\/threads$/);
  if (threadsMatch) {
    const prNumber = parseInt(threadsMatch[1]);
    try {
      const threads = await github.listReviewThreads(prNumber);
      const dispositions = threadStore.getDispositions(prNumber);
      return json({ prNumber, threads, dispositions });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, 500);
    }
  }

  const markMatch = url.pathname.match(
    /^\/api\/pr\/(\d+)\/threads\/([^/]+)\/disposition$/
  );
  if (markMatch && req.method === "PUT") {
    const prNumber = parseInt(markMatch[1]);
    const threadId = decodeURIComponent(markMatch[2]);
    try {
      const body = JSON.parse(await readBody()) as { disposition: string };
      const record = threadStore.markThread(
        prNumber,
        threadId,
        body.disposition as import("./types").DispositionKind
      );
      return json(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, 500);
    }
  }

  if (markMatch && req.method === "DELETE") {
    const prNumber = parseInt(markMatch[1]);
    const threadId = decodeURIComponent(markMatch[2]);
    threadStore.unmarkThread(prNumber, threadId);
    return json({ ok: true });
  }

  // Serve static UI files
  const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const fullPath = join(UI_DIST, filePath);

  if (existsSync(fullPath) && !fullPath.includes("..")) {
    const content = readFileSync(fullPath);
    res.writeHead(200, { "Content-Type": getMime(filePath) });
    return res.end(content);
  }

  // SPA fallback
  const indexPath = join(UI_DIST, "index.html");
  if (existsSync(indexPath)) {
    const content = readFileSync(indexPath);
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(content);
  }

  res.writeHead(404);
  res.end("Not Found");
});

// WebSocket server
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws) => {
  clients.add(ws);

  sendTo(ws, { type: "state", data: store.getState() });

  if (store.lastError) {
    sendTo(ws, { type: "error", message: store.lastError });
  }

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(String(raw)) as ClientMessage;
      switch (data.type) {
        case "refresh":
          refresh();
          break;
        case "fetch_threads":
          fetchAndSendThreads(ws, data.prNumber);
          break;
        case "mark_thread":
          handleMarkThread(ws, data.prNumber, data.threadId, data);
          break;
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

httpServer.listen(PORT, () => {
  console.log(`orc: dashboard at http://localhost:${PORT}`);
});
