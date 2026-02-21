# orc

Interactive terminal dashboard that automates PR feedback loops. It monitors your open GitHub pull requests, fetches review comments and CI results, categorizes feedback by severity using Claude Code, fixes issues automatically in isolated git worktrees, verifies changes, and pushes fixes back — looping until PRs are clean.

## Prerequisites

- **Node.js >= 22**
- **Yarn 4** (v4.5.1) — do not use npm
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** installed and authenticated (requires an active Claude Code subscription)
- **[GitHub CLI](https://cli.github.com/)** (`gh`) installed and authenticated with repo access
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
```

## Architecture

- **TypeScript + Node.js** — strict mode, ES2022 target, Node16 modules
- **Ink + React** — terminal UI framework (React 18 components rendered in the terminal)
- **@anthropic-ai/claude-code** — Agent SDK for AI-powered code fixes
- **Commander** — CLI argument parsing
- **Zod** — runtime config validation
- **Vitest** — test runner

### Project Structure

- `bin/orc.ts` — CLI entry point
- `src/cli.ts` — Commander setup
- `src/commands/` — CLI command handlers
- `src/core/` — daemon, session controller, comment fetcher/categorizer, fix executor, git/worktree management, thread responder
- `src/github/` — GitHub CLI wrapper, GraphQL queries, types
- `src/tui/` — Ink/React components, hooks, theming
- `src/types/` — domain types and config schemas
- `src/utils/` — logging, process execution, retry logic, notifications

## Per-Repo Configuration

Repositories can include an `ORC.md` file at the root to provide custom instructions, verify commands, and auto-fix policies for orc to follow.
