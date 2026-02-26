# orc

Interactive terminal dashboard for monitoring your open GitHub pull requests. It fetches review comments and CI results, displays thread status, and gives you a live overview of PR health across your repo.

## Prerequisites

- **Node.js >= 22**
- **[GitHub CLI](https://cli.github.com/)** (`gh`) installed and authenticated with repo access — or a `GITHUB_TOKEN` env var
- **Git** installed

## Common Commands

```bash
yarn install        # Install dependencies
yarn build          # Compile TypeScript
yarn dev            # Watch mode (rebuilds on change)
yarn lint           # Lint source files
yarn typecheck      # Type-check without emitting
yarn test           # Run tests
yarn test:watch     # Run tests in watch mode
yarn start          # Run the TUI dashboard
```

## Architecture

- **TypeScript + Node.js** — strict mode, ES2022 target, ESM
- **Ink + React** — terminal UI framework (React 18 components rendered in the terminal)
- **Zod** — runtime config validation
- **Vitest** — test runner

### Project Structure

- `bin/orc.sh` — Shell entry point
- `src/index.tsx` — App initialization (env, repo detection, token, render)
- `src/types.ts` — Domain types (Branch, PR, threads, dispositions, GitHub API)
- `src/github/client.ts` — GitHub GraphQL client (PRs, threads, merged PRs)
- `src/git/branches.ts` — List local branches
- `src/git/repo.ts` — Detect repo info from git remote
- `src/state/store.ts` — BranchStore (in-memory dashboard state)
- `src/state/thread-store.ts` — ThreadStore (persisted thread dispositions)
- `src/tui/App.tsx` — Root Ink component (refresh loop, keyboard input, view switching)
- `src/tui/Header.tsx` — Top bar (repo info, PR count, refresh countdown)
- `src/tui/PRTable.tsx` — PR table with cursor selection
- `src/tui/PRDetail.tsx` — PR detail view (review threads)
- `src/tui/Footer.tsx` — Keyboard shortcut hints
- `src/utils/env.ts` — .env file loader
- `src/utils/exec.ts` — Shell command execution helpers

## Per-Repo Configuration

Repositories can include an `ORC.md` file at the root to provide custom instructions for orc to follow.

## Git Conventions

- **Conventional Commits** — all commit messages must use the format `type: description` (e.g. `feat: add worktree pooling`, `fix: handle missing CI checks`, `chore: update dependencies`). Common types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`.
- **Rebase over merge** — prefer rebasing onto the target branch instead of creating merge commits. Keep history linear and clean.
- **Yarn only** — always use `yarn` for package management. Never use `npm` or `pnpm`.
- **Verify build before pushing** — run `yarn build` to make sure the project compiles cleanly.
