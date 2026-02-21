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

## Tech Stack

orc is built with:

- **TypeScript + Node.js**: Core runtime for cross-platform CLI tooling and robust type safety
- **Ink**: React-like framework for building rich terminal user interfaces with component-based architecture
- **GitHub CLI (`gh`)**: Official GitHub API client for reliable repository and PR operations
- **Claude Code**: AI-powered code editing with repository context for intelligent automated fixes
- **Git Worktrees**: Isolated working directories for safe parallel PR processing without conflicts

This stack was chosen to provide a responsive terminal UI while leveraging proven tools for GitHub integration and AI-assisted code modifications.

## Prerequisites

- Node.js >= 20
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated with repo access
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Install

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
npx orc start my-feature-branch

# Watch multiple branches in TUI
npx orc start branch-a branch-b

# With options
npx orc start my-branch \
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

No. orc is a CI/CD automation tool that invokes Claude Code as a subprocess — it does not access the Anthropic API directly or tamper with Claude Code's authentication. Specifically:

- **No direct API calls.** orc never makes HTTP requests to `api.anthropic.com` or any Anthropic endpoint. All Claude interactions go through the official [Claude Code Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) (`@anthropic-ai/claude-code`), which spawns Claude Code as a subprocess.
- **No token extraction.** orc never reads, stores, or forwards OAuth tokens, session tokens, or any credentials from Claude Code's internal state or config files.
- **No header spoofing.** orc never sets `Authorization`, `User-Agent`, `X-Api-Key`, or any other HTTP header to impersonate Claude Code.
- **No credential parsing.** orc never accesses `~/.claude`, Claude Code's authentication files, or any credential storage. Authentication is handled entirely by Claude Code itself.

orc is architecturally equivalent to a shell script that runs `claude` commands in a loop — it just adds a TUI dashboard and PR-aware orchestration on top.

## License

MIT
