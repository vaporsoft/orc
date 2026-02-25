import { join } from "path";
import { BranchStore } from "./state/store";
import { GitHubClient } from "./github/client";
import { listLocalBranches } from "./git/branches";
import { getRepoRoot, getRepoInfo } from "./git/repo";
import type { ServerMessage, ClientMessage, DashboardState } from "./types";
import type { ServerWebSocket } from "bun";

const PORT = parseInt(process.env.ORC_PORT || "3333");
const REPO_PATH = process.env.ORC_REPO || process.cwd();
const REFRESH_INTERVAL = 30_000; // 30 seconds

// --- Initialize ---

console.log(`orc: detecting repo at ${REPO_PATH}...`);
const repoRoot = await getRepoRoot(REPO_PATH);
const repoInfo = await getRepoInfo(repoRoot);
console.log(`orc: ${repoInfo.owner}/${repoInfo.repo} (default: ${repoInfo.defaultBranch})`);

const github = new GitHubClient(repoInfo.owner, repoInfo.repo);
const store = new BranchStore();
store.setRepoInfo(repoInfo);

// --- WebSocket clients ---

const clients = new Set<ServerWebSocket<unknown>>();

function broadcast(msg: ServerMessage) {
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    client.send(payload);
  }
}

// --- Refresh loop ---

async function refresh() {
  try {
    const [branches, prs] = await Promise.all([
      listLocalBranches(repoRoot),
      github.listOpenPRs(),
    ]);
    store.update(branches, prs);
    broadcast({ type: "state", data: store.getState() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`orc: refresh failed: ${message}`);
    broadcast({ type: "error", message });
  }
}

await refresh();
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
      ws.send(JSON.stringify({ type: "state", data: store.getState() } satisfies ServerMessage));
    },

    message(ws, msg) {
      try {
        const data = JSON.parse(String(msg)) as ClientMessage;
        if (data.type === "refresh") {
          refresh();
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
