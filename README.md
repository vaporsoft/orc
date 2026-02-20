# pr-pilot

Interactive terminal dashboard to automate PR feedback loops — poll reviews & CI, fix with Claude Code, push, repeat.

## What it does

pr-pilot provides an interactive terminal dashboard to monitor your open pull requests. It:

1. **Monitors** multiple PRs simultaneously with real-time status updates
2. **Polls** for new review comments and CI failures
3. **Analyzes** feedback to classify severity (must-fix, should-fix, nice-to-have, false-positive)
4. **Fixes** issues using Claude Code in isolated git worktrees
5. **Pushes** changes and continues monitoring

You can manually start/stop monitoring per PR or let it run automatically until each PR is clean.

## Prerequisites

- Node.js >= 20
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated with repo access
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Install

```bash
yarn install
yarn build
```

## Usage

```bash
# Start interactive TUI dashboard for one or more branches
npx pr-pilot start my-feature-branch

# Watch multiple branches in TUI
npx pr-pilot start branch-a branch-b

# With options
npx pr-pilot start my-branch \
  --poll-interval 60 \
  --max-loops 5 \
  --confidence 0.8 \
  --dry-run
```

### Interactive TUI Controls

Once started, pr-pilot opens an interactive terminal dashboard with these controls:

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
- **Real-time status** of each PR being monitored
- **Last check timestamp** for polling activity
- **Detailed information** about comments, CI status, and fixes
- **Scrollable logs** accessible via Tab key

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--max-loops <n>` | Max fix iterations per branch | 10 |
| `--poll-interval <n>` | Seconds between polls | 30 |
| `--debounce <n>` | Seconds to wait after last event | 60 |
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

## License

MIT
