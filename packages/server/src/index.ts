import { join } from "path";
import { BranchStore, type ThreadSummary } from "./state/store";
import { ThreadStore } from "./state/thread-store";
import { GitHubClient, resolveToken } from "./github/client";
import { loadEnv } from "./env";
import { listLocalBranches } from "./git/branches";
import { getRepoRoot, getRepoInfo } from "./git/repo";
import type { ServerMessage, ClientMessage } from "./types";
import type { ServerWebSocket } from "bun";

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

const clients = new Set<ServerWebSocket<unknown>>();

function broadcast(msg: ServerMessage) {
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    client.send(payload);
  }
}

function sendTo(ws: ServerWebSocket<unknown>, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

// --- Refresh loop ---

async function refresh() {
  try {
    const [branches, prs] = await Promise.all([
      listLocalBranches(repoRoot),
      github.listOpenPRs(),
    ]);

    console.log(`orc: found ${prs.length} open PR(s), ${branches.length} local branch(es)`);

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
    store.lastError = null;

    // Prune dispositions for PRs that are no longer open
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

async function fetchAndSendThreads(
  ws: ServerWebSocket<unknown>,
  prNumber: number
) {
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
  ws: ServerWebSocket<unknown>,
  prNumber: number,
  threadId: string,
  disposition: ClientMessage & { type: "mark_thread" }
) {
  threadStore.markThread(prNumber, threadId, disposition.disposition);
  // Re-fetch threads and broadcast full state to all clients
  try {
    const threads = await github.listReviewThreads(prNumber);
    const dispositions = threadStore.getDispositions(prNumber);
    broadcast({
      type: "threads",
      data: { prNumber, threads, dispositions },
    });
  } catch {
    // If re-fetch fails, at least send dispositions-only to the requester
    const dispositions = threadStore.getDispositions(prNumber);
    sendTo(ws, {
      type: "threads",
      data: { prNumber, threads: [], dispositions },
    });
  }
}

// Run first refresh — log errors to console since no WS clients yet
try {
  await refresh();
} catch (err) {
  console.error("orc: initial refresh failed:", err);
}
setInterval(refresh, REFRESH_INTERVAL);

// --- HTTP + WebSocket server ---

const UI_DIST = join(import.meta.dir, "../../ui/dist");

const server = Bun.serve({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // REST API
    if (url.pathname === "/api/state") {
      return Response.json(store.getState());
    }

    if (url.pathname === "/api/refresh" && req.method === "POST") {
      await refresh();
      return Response.json({ ok: true });
    }

    // REST: get threads for a PR
    const threadsMatch = url.pathname.match(/^\/api\/pr\/(\d+)\/threads$/);
    if (threadsMatch) {
      const prNumber = parseInt(threadsMatch[1]);
      try {
        const threads = await github.listReviewThreads(prNumber);
        const dispositions = threadStore.getDispositions(prNumber);
        return Response.json({ prNumber, threads, dispositions });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ error: message }, { status: 500 });
      }
    }

    // REST: mark a thread
    const markMatch = url.pathname.match(
      /^\/api\/pr\/(\d+)\/threads\/([^/]+)\/disposition$/
    );
    if (markMatch && req.method === "PUT") {
      const prNumber = parseInt(markMatch[1]);
      const threadId = decodeURIComponent(markMatch[2]);
      try {
        const body = (await req.json()) as { disposition: string };
        const record = threadStore.markThread(
          prNumber,
          threadId,
          body.disposition as import("./types").DispositionKind
        );
        return Response.json(record);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ error: message }, { status: 500 });
      }
    }

    // REST: unmark a thread
    if (markMatch && req.method === "DELETE") {
      const prNumber = parseInt(markMatch[1]);
      const threadId = decodeURIComponent(markMatch[2]);
      threadStore.unmarkThread(prNumber, threadId);
      return Response.json({ ok: true });
    }

    // Serve static UI files
    const filePath =
      url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(join(UI_DIST, filePath));
    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback — serve index.html for client-side routing
    const index = Bun.file(join(UI_DIST, "index.html"));
    if (await index.exists()) {
      return new Response(index);
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      clients.add(ws);
      // Send current state on connect
      ws.send(
        JSON.stringify({
          type: "state",
          data: store.getState(),
        } satisfies ServerMessage)
      );
      // Send last error if there is one (e.g. from initial refresh before client connected)
      if (store.lastError) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: store.lastError,
          } satisfies ServerMessage)
        );
      }
    },

    message(ws, msg) {
      try {
        const data = JSON.parse(String(msg)) as ClientMessage;
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
    },

    close(ws) {
      clients.delete(ws);
    },
  },
});

console.log(`orc: dashboard at http://localhost:${server.port}`);
