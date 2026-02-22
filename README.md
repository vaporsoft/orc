# orc

Interactive terminal dashboard to automate PR feedback loops — poll reviews & CI, fix with Claude Code, push, repeat.

## What it does

orc provides an interactive terminal dashboard to monitor your open pull requests. It:

1. **Monitors** multiple PRs simultaneously with real-time status updates
2. **Fetches** new review comments and conversation threads
3. **Categorizes** feedback to classify severity (must-fix, should-fix, nice-to-have, false-positive)
4. **Fixes** issues using Claude Code in isolated git worktrees with repo-specific context
5. **Verifies** changes with configured commands, pushes, and replies to threads

You can manually start/stop monitoring per PR or let it run automatically until each PR is clean.

## How it works

orc is designed to run as a background process on your machine while you work. The intended workflow:

1. **You open PRs as usual.** Push your branch, create a PR on GitHub, request reviews.
2. **Start orc.** Run `orc start my-branch` (or pass multiple branches). orc opens a terminal dashboard and begins polling.
3. **Reviewers leave comments.** orc detects new review comments and CI failures on each poll cycle.
4. **orc categorizes feedback.** Each comment is classified by severity — `must-fix`, `should-fix`, `nice-to-have`, or `false-positive` — so it knows what to act on and what to skip.
5. **orc fixes issues autonomously.** For actionable comments, orc checks out the branch in an isolated git worktree, invokes Claude Code with the review context and any repo-specific instructions from `ORC.md`, and applies the fix.
6. **orc verifies and pushes.** After fixing, orc runs your configured verify commands (lint, typecheck, tests). If they pass, it pushes the fix and replies to the review thread. If they fail, it retries.
7. **The loop repeats.** orc continues polling until there are no more actionable comments, the max loop count is reached, or you stop it manually.

The net effect: you get a PR up, context-switch to other work, and come back to find review feedback already addressed. You stay in the loop via the dashboard and can intervene at any point.

## Tech Stack

orc is built with:

- **TypeScript + Node.js**: Core runtime for cross-platform CLI tooling and robust type safety
- **Ink**: React-like framework for building rich terminal user interfaces with component-based architecture
- **GitHub CLI (`gh`)**: Official GitHub API client for reliable repository and PR operations
- **Claude Code**: AI-powered code editing with repository context for intelligent automated fixes
- **Git Worktrees**: Isolated working directories for safe parallel PR processing without conflicts

This stack was chosen to provide a responsive terminal UI while leveraging proven tools for GitHub integration and AI-assisted code modifications.

## Prerequisites

- Node.js >= 22
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated with repo access
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Install

```bash
# Install globally
npm install -g @vaporsoft/orc

# Or run directly with npx
npx @vaporsoft/orc start my-branch
```

### From source

```bash
yarn install
yarn build
```

## Configuration

orc can be configured per-repository using an `ORC.md` file in your repo root:

```markdown
# Orc

## Instructions
Custom instructions passed to Claude Code for context about your project.

## Verify
- `yarn lint`
- `yarn typecheck`
- `npm test`

## Auto-fix
- must_fix: true
- should_fix: true
- nice_to_have: false
```

The configuration allows you to:
- **Instructions**: Provide project-specific context for Claude Code
- **Verify**: Define commands to run after fixes (linting, testing, etc.)
- **Auto-fix**: Control which comment severities to automatically fix

## Usage

```bash
# Start interactive TUI dashboard for one or more branches
orc start my-feature-branch

# Watch multiple branches in TUI
orc start branch-a branch-b

# With options
orc start my-branch \
  --poll-interval 60 \
  --max-loops 5 \
  --confidence 0.8 \
  --dry-run
```

### Interactive TUI Controls

Once started, orc opens an interactive terminal dashboard with these controls:

| Key | Action |
|-----|--------|
| `q` | Quit |
| `r` | Refresh all PRs immediately |
| `Tab` | Toggle between Sessions and Logs view |
| `↑`/`↓` | Navigate sessions or scroll logs |
| `Enter` | Start/stop monitoring for selected PR |
| `a` | Start monitoring all PRs |
| `x` | Stop monitoring all PRs |

The dashboard shows:
- **Real-time status** of each PR being monitored with comment counts
- **Last check timestamp** for polling activity
- **Detailed information** about comments, CI status, and fixes
- **Scrollable logs** accessible via Tab key

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--max-loops <n>` | Max fix iterations per branch | 10 |
| `--poll-interval <n>` | Seconds between polls | 30 |
| `--confidence <n>` | Min confidence to act on a comment (0-1) | 0.75 |
| `--model <model>` | Claude model for fixes | — |
| `--max-turns <n>` | Max turns per Claude Code session | 30 |
| `--claude-timeout <n>` | Seconds before killing Claude Code | 900 |
| `--dry-run` | Show what would be done without executing | — |
| `--verbose` | Include detailed output | — |

## Development

```bash
yarn dev         # Watch mode (rebuilds on change)
yarn typecheck   # Type-check without emitting
yarn lint        # Lint source files
yarn test        # Run tests
yarn test:watch  # Run tests in watch mode
```

## FAQ

### Does this violate Anthropic's Terms of Service?

No. `orc` is a CI/CD automation tool that invokes Claude Code as a subprocess — it does not access the Anthropic API directly or tamper with Claude Code's authentication. Specifically:

- **No direct API calls.** `orc` never makes HTTP requests to `api.anthropic.com` or any Anthropic endpoint. All Claude interactions go through the official [Claude Code Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) (`@anthropic-ai/claude-code`), which spawns Claude Code as a subprocess.
- **No token extraction.** `orc` never reads, stores, or forwards OAuth tokens, session tokens, or any credentials from Claude Code's internal state or config files.
- **No header spoofing.** `orc` never sets `Authorization`, `User-Agent`, `X-Api-Key`, or any other HTTP header to impersonate Claude Code.
- **No credential parsing.** `orc` never accesses `~/.claude`, Claude Code's authentication files, or any credential storage. Authentication is handled entirely by Claude Code itself.

`orc` is architecturally equivalent to a shell script that runs `claude` commands in a loop — it just adds a TUI dashboard and PR-aware orchestration on top.

## Disclaimers

**This software is provided "as is", without warranty of any kind.** By using orc, you acknowledge and agree to the following:

- **Cost responsibility.** orc invokes Claude Code, which requires an active [Claude Code subscription](https://docs.anthropic.com/en/docs/claude-code). Each fix cycle consumes usage against your subscription or API quota. The authors are not responsible for any costs, charges, or overages incurred through use of this software.
- **Autonomous code changes.** orc is designed to automatically modify code, commit, and push to your GitHub repositories. While it operates in isolated worktrees and runs configured verification commands, the authors make no guarantees about the correctness, safety, or suitability of any changes it produces. You are solely responsible for reviewing and accepting changes pushed to your repositories.
- **No liability.** In no event shall the authors or copyright holders be liable for any claim, damages, or other liability arising from the use of this software, including but not limited to data loss, repository corruption, CI/CD costs, or unintended code modifications.
- **Third-party services.** orc depends on third-party services (GitHub, Claude Code) that have their own terms of service, pricing, and availability. The authors make no guarantees about the availability or behavior of these services and are not responsible for changes to their terms or pricing.

Use of this software constitutes acceptance of these terms. Always review changes before merging, and use the `--dry-run` flag to preview behavior before enabling autonomous fixes.

## License

[MIT](./LICENSE)
