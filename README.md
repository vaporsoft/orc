# pr-pilot

Automate PR feedback loops — poll reviews & CI, fix with Claude Code, push, repeat.

## What it does

pr-pilot watches your open pull requests and automatically:

1. **Polls** for new review comments and CI failures
2. **Analyzes** feedback to classify severity (must-fix, should-fix, nice-to-have, false-positive)
3. **Fixes** issues using Claude Code in isolated git worktrees
4. **Pushes** changes and moves on to the next round

It keeps looping until the PR is clean or a configurable iteration limit is reached.

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
# Watch one or more branches
npx pr-pilot start my-feature-branch

# Watch multiple branches
npx pr-pilot start branch-a branch-b

# With options
npx pr-pilot start my-branch \
  --poll-interval 60 \
  --max-loops 5 \
  --confidence 0.8 \
  --dry-run
```

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
