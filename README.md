# orc

Automate PR feedback loops with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Poll reviews & CI, fix issues, push, repeat.

![orc terminal dashboard](https://i.imgur.com/E3q8QTQ.png)

## What it does

orc monitors your open pull requests and handles review feedback automatically. It polls for new comments and CI results, categorizes feedback by severity, fixes issues using Claude Code in isolated git worktrees, verifies the changes, and pushes — looping until your PRs are clean.

You stay in control via an interactive terminal dashboard. Start and stop monitoring per PR, watch logs in real time, or let it run hands-free.

## Getting started

orc requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and the [GitHub CLI](https://cli.github.com/) (`gh`). Both must be installed and authenticated before running orc — it will check `gh auth status` on startup and uses Claude Code to apply fixes.

### Install

```bash
npm install -g @vaporsoft/orc
```

### Run

```bash
orc
```

That's it. orc discovers your open PRs and starts the dashboard. You can also pass specific branches if you want to focus on a subset:

```bash
orc start my-branch other-branch
```

### Initialize a repo (optional)

```bash
orc init
```

Generates `ORC.md` and `orc.config.json` in your repo with sensible defaults based on your project's ecosystem (Node, Rust, Go, Python, etc.).

## Configuration

orc is configured per-repository with two files at the repo root. Both are optional — orc works with sensible defaults out of the box.

### `ORC.md` — instructions for Claude Code

Freeform markdown that gives Claude Code context about your project. This is passed directly to Claude when fixing issues, so include anything that helps it understand your codebase: coding conventions, architecture notes, domain-specific rules, etc.

```markdown
# Orc

Use conventional commits. Prefer `async`/`await` over raw promises.
Never modify generated files in `src/generated/`.
```

### `orc.config.json` — commands and policies

Structured configuration for setup commands, verification, allowed commands, and auto-fix policies.

```json
{
  "setup": ["yarn install"],
  "verify": ["yarn lint", "yarn typecheck", "yarn test"],
  "allowedCommands": ["yarn *"],
  "autoFix": {
    "must_fix": true,
    "should_fix": true,
    "nice_to_have": false,
    "verify_and_fix": true,
    "needs_clarification": true
  }
}
```

All fields are optional:

| Field | Description | Default |
|-------|-------------|---------|
| `setup` | Commands to run before making fixes | `[]` |
| `verify` | Commands to verify changes (lint, test, etc.) | `[]` |
| `allowedCommands` | Commands Claude Code is allowed to execute (supports globs) | `[]` |
| `autoFix.must_fix` | Auto-fix comments marked must-fix | `true` |
| `autoFix.should_fix` | Auto-fix comments marked should-fix | `true` |
| `autoFix.nice_to_have` | Auto-fix nice-to-have suggestions | `false` |
| `autoFix.verify_and_fix` | Auto-fix CI/verification failures | `true` |
| `autoFix.needs_clarification` | Attempt to fix ambiguous comments | `true` |

## Dashboard controls

| Key | Action |
|-----|--------|
| `q` | Quit |
| `r` | Refresh all PRs |
| `Tab` | Toggle between Sessions and Logs view |
| `↑`/`↓` | Navigate sessions or scroll logs |
| `Enter` | Start/stop monitoring for selected PR |
| `a` | Start monitoring all PRs |
| `x` | Stop monitoring all PRs |

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--poll-interval <n>` | Seconds between polls | `30` |
| `--confidence <n>` | Min confidence to act on a comment (0-1) | `0.75` |
| `--model <model>` | Claude model for fixes | `sonnet` |
| `--session-timeout <n>` | Hours before stopping (0 = unlimited) | `0` |
| `--claude-timeout <n>` | Seconds before killing a Claude Code session | `900` |
| `--dry-run` | Preview what would be done without executing | — |
| `--verbose` | Show detailed output | — |

## FAQ

### Does this violate Anthropic's Terms of Service?

No. orc invokes Claude Code as a subprocess via the official [Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) — it never calls the Anthropic API directly, extracts tokens, spoofs headers, or accesses Claude Code's credential storage. It's architecturally equivalent to a shell script that runs `claude` in a loop, with a dashboard and PR-aware orchestration on top.

## Disclaimers

**This software is provided "as is", without warranty of any kind.** By using orc, you acknowledge:

- **Cost responsibility.** orc invokes Claude Code, which requires an active [subscription](https://docs.anthropic.com/en/docs/claude-code). Each fix cycle consumes usage against your quota. The authors are not responsible for any costs incurred.
- **Autonomous code changes.** orc automatically modifies, commits, and pushes code to your repositories. The authors make no guarantees about correctness or safety. You are solely responsible for reviewing changes.
- **No liability.** The authors are not liable for any damages arising from use of this software, including data loss, repository corruption, or unintended modifications.
- **Third-party services.** orc depends on GitHub and Claude Code, which have their own terms and pricing.

Use `--dry-run` to preview behavior before enabling autonomous fixes.

## License

Proprietary. See [LICENSE](./LICENSE).
