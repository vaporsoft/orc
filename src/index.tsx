import React from "react";
import { render } from "ink";
import { loadEnv } from "./utils/env";
import { getRepoRoot, getRepoInfo } from "./git/repo";
import { resolveToken, GitHubClient } from "./github/client";
import { BranchStore } from "./state/store";
import { ThreadStore } from "./state/thread-store";
import { App } from "./tui/App";

// Load .env from repo root
await loadEnv();

const REPO_PATH = process.env.ORC_REPO || process.cwd();

// Detect repo
let repoRoot: string;
try {
  repoRoot = await getRepoRoot(REPO_PATH);
} catch {
  console.error(`orc: not a git repository: ${REPO_PATH}`);
  process.exit(1);
}

const repoInfo = await getRepoInfo(repoRoot);

// Resolve GitHub token
let token: string;
try {
  token = await resolveToken();
} catch (err) {
  console.error(
    `orc: ${err instanceof Error ? err.message : "failed to resolve GitHub token"}`
  );
  process.exit(1);
}

const github = new GitHubClient(repoInfo.owner, repoInfo.repo, token);
const store = new BranchStore();
store.setRepoInfo(repoInfo);
const threadStore = new ThreadStore();

// Clear screen and render TUI
process.stdout.write("\x1B[2J\x1B[H");

const { waitUntilExit } = render(
  <App
    github={github}
    store={store}
    threadStore={threadStore}
    repoRoot={repoRoot}
  />
);

await waitUntilExit();
