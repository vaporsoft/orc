# SaaS Viability Analysis: orc as a Product

## Executive Summary

orc has a genuine differentiator — the **autonomous feedback loop** (fetch → categorize → fix → verify → push → reply → loop). No competitor fully closes this loop. But the path to a SaaS is blocked by a hard dependency on the Claude Agent SDK's authentication model, and the market is crowding fast. The more compelling play may be to lean into orc's real unique value: the **30,000-foot dashboard** for managing multiple concurrent AI coding sessions.

---

## Part 1: Technical Analysis — GitHub App Migration

### The Identity Problem Today

orc runs under the user's personal GitHub account. This creates three compounding issues:

1. **No bot identity** — orc detects its own replies via a regex signature (`/^\*Orc — .+ \(confidence: [\d.]+\)\*$/m` in `src/core/comment-fetcher.ts:18`). This is brittle. Any change to the signature format, or a user manually typing something similar, breaks detection.

2. **Bot-to-bot feedback loops** — other GitHub bots (e.g. `claude[bot]`) can't distinguish orc's comments from the user's. This caused the 145+ spam comment incident on PR #480. The fix in #99 adds timing-based heuristics (`lastOrcReplyAt` in `comment-fetcher.ts:84-89`) and body-content matching (`containsQuotedComment` in `utils/quoting.ts:21-42`), but these are inherently fragile — we're pattern-matching around the absence of proper identity.

3. **Permission scope** — orc inherits whatever `gh auth` scope the user has. There's no way to limit it to specific repos or grant it only the permissions it needs.

### What a GitHub App Would Solve

| Problem | Current Approach | With GitHub App |
|---|---|---|
| Identity detection | Regex on comment body | `comment.author.login === "orc[bot]"` |
| Bot loop prevention | Timing heuristics + body matching | GitHub suppresses bot-to-bot webhook noise; other bots see `[bot]` suffix and ignore |
| Deduplication | `isOrcReply()` + `containsQuotedComment()` | Simple author check |
| Permissions | User's full `gh auth` scope | Fine-grained: `pull_requests: write`, `checks: read`, `contents: write` |
| Rate limits | Shared with user's personal API usage | Separate pool (5,000 req/hr per installation) |

### Required Permissions

| Permission | Level | Purpose |
|---|---|---|
| `pull_requests` | Read & Write | Read PR data, post review comments, resolve threads |
| `issues` | Read & Write | Conversation-tab comments (PR comments use the issues API) |
| `checks` | Read | Read CI check runs and `statusCheckRollup` |
| `statuses` | Read | Commit statuses from older CI providers |
| `contents` | Read & Write | Clone repos, push fix commits |
| `metadata` | Read | Implicitly required |

### Authentication Changes

**Current flow:** Everything goes through `gh` CLI → inherits user's OAuth token → git push uses user's credential helper.

**GitHub App flow:**
1. App generates a **JWT** (local crypto, RS256, 10-min lifetime) using its private key + App ID
2. Exchanges JWT for an **installation access token** via `POST /app/installations/{id}/access_tokens`
3. Installation token expires in **1 hour** (non-configurable)
4. Git push changes to: `https://x-access-token:<TOKEN>@github.com/owner/repo.git`

**Impact on orc's codebase:**

- `src/github/gh-client.ts` — currently shells out to `gh api`. Would need to switch to direct HTTP (Octokit) or set `GH_TOKEN` env var for the `gh` CLI to pick up the installation token.
- `src/core/worktree-manager.ts:45-52` — `git fetch origin` and worktree creation use the user's git credentials. Would need to inject installation tokens into remote URLs.
- `src/core/git-manager.ts` — `git push --force-with-lease` would need the `x-access-token` URL pattern.
- Token refresh — need a renewal strategy since tokens expire hourly. Either proactive refresh at ~50 minutes, or catch 401 errors and regenerate.

### Installation UX

Two modes:
- **Per-repo**: User installs the app on specific repositories. Lower trust barrier.
- **Org-wide**: One install covers all repos in the org. Better for teams.

Both are supported simultaneously. Users choose during GitHub's standard app installation flow.

### Can We Support Dual Mode?

Yes, but it's non-trivial. The abstraction boundary would be at the `GHClient` level:

```
interface GitHubAuth {
  getToken(): Promise<string>;
  getCurrentUser(): Promise<string>;
  isBot(): boolean;
}

// Two implementations:
class PersonalAuth implements GitHubAuth { ... }  // current gh-cli approach
class AppAuth implements GitHubAuth { ... }        // JWT → installation token
```

The `CommentFetcher` would check `auth.isBot()` to decide between regex-based detection and author-based detection. `WorktreeManager` and `GitManager` would use `auth.getToken()` for remote URLs.

It's ~2-3 weeks of refactoring, not a rewrite. But it doubles the test surface.

---

## Part 2: The Claude SDK Problem (The Real Blocker)

### How orc uses Claude today

orc depends on `@anthropic-ai/claude-agent-sdk` (v0.1.x) in two places:

1. **Comment categorization** (`src/core/comment-categorizer.ts`) — single-turn LLM call to classify review comments by severity. `maxTurns: 1`, no tools.
2. **Fix execution** (`src/core/fix-executor.ts`) — multi-turn agentic session with full tool access (`Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`). Uses `permissionMode: "bypassPermissions"` for autonomous operation.

Neither file explicitly configures auth — the SDK picks up `ANTHROPIC_API_KEY` from the environment or falls back to an existing OAuth login from `claude /login`.

### Server/SaaS deployment — what works

The Agent SDK **explicitly supports** headless server deployment:
- `ANTHROPIC_API_KEY` environment variable for API-key auth (pay-as-you-go)
- Cloud provider routing: Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`), Vertex (`CLAUDE_CODE_USE_VERTEX=1`), Azure Foundry
- `permissionMode: "bypassPermissions"` for fully autonomous operation (already used)
- No UI or interactive login required

### The licensing catch

Anthropic's terms **prohibit using OAuth (consumer subscription) login for third-party or server use**. This means:

- **For personal use**: orc works fine with your own Claude subscription or API key. No issues.
- **For a SaaS**: You cannot piggyback on users' Claude subscriptions. You'd need to:
  - Run under **your own** `ANTHROPIC_API_KEY` (you pay for all token usage)
  - Or route through Bedrock/Vertex (same — you pay)

### Cost implications for SaaS

This is the killer. Each orc "fix cycle" for a single branch involves:

1. **Categorization**: ~1K-5K tokens per comment (cheap, maybe $0.01-0.05 per batch)
2. **Fix execution**: Multi-turn agentic session with tool use. Realistically **50K-500K tokens per cycle** depending on complexity. At Sonnet rates (~$3/M input, $15/M output), that's roughly **$0.50-$5.00 per fix cycle**.
3. **CI fix cycles**: Similar cost profile.

For a watched branch doing continuous loops, costs compound. A single PR with 3-4 review rounds could easily cost $5-20 in API usage.

**This means a SaaS orc would need to either:**
- Charge enough to cover API costs + margin (probably $50-100+/user/month)
- Pass API costs through to users (BYOK — bring your own key)
- Accept thin or negative margins on heavy users

BYOK is the most viable model but reduces the "SaaS magic" — users are back to managing their own API keys.

---

## Part 3: Market Landscape

### Direct Competitors (as of early 2026)

| Tool | What it does | Feedback loop? | Price |
|---|---|---|---|
| **CodeRabbit** | AI code review, line-by-line comments | Review only — no auto-fix loop | $24/dev/mo |
| **Copilot Code Review** | AI review + can hand off to Copilot agent | Creates **separate PR** with fixes, doesn't iterate | Bundled with Copilot ($10-39/mo) |
| **Graphite Agent** | AI review + chat + one-click fixes + merge queue | Fixes inline but doesn't loop autonomously | $40/user/mo |
| **Qodo (formerly Codium)** | Multi-agent review + "Agent Skills" for fixes | Closest competitor — iterates through issues and pushes commits. But operates as a skill plugin, not standalone | $30/user/mo |
| **Ellipsis** | YC-backed AI reviewer | Review + some auto-fixes | $20-40/dev/mo |
| **Sourcery** | AI review focused on code quality | Review only | $30/dev/mo |

### orc's Differentiator

None of these tools do what orc does end-to-end:

1. **Fetch** unresolved review comments and CI failures
2. **Categorize** by severity with nuanced heuristics (verify_and_fix, must_fix, should_fix, etc.)
3. **Fix** autonomously in isolated worktrees using a full-power coding agent
4. **Verify** changes against repo-specific commands
5. **Rebase + push** with autosquash
6. **Reply** to threads with context-aware responses, resolve threads
7. **Re-request review** from the original reviewer
8. **Loop** until the PR is clean or manually stopped

The closest is Qodo's `qodo-pr-resolver`, but it operates as a plugin to existing coding agents rather than an autonomous daemon.

### The Gap orc Could Own

The market is saturated with **review bots**. Nobody owns the **fix loop**. But the economics are hard because the fix loop is where all the API cost lives.

---

## Part 4: The "Just a Script" Question

> "This could just be a GitHub script, right? Whenever there's feedback it calls a Claude Code instance to fix."

Technically, yes. A GitHub Action or webhook-triggered script could:
1. Listen for review comment events
2. Spawn Claude Code to fix
3. Push the result

But that misses what makes orc valuable. A script gives you fire-and-forget. orc gives you:

- **Visibility** — the TUI dashboard showing all branches, their status, comment counts, CI state, Claude activity, costs
- **Control** — fix this branch, watch that one, stop all, address comments only, fix CI only, open a shell in the worktree, resume a Claude session
- **Judgment** — the categorization layer that decides what to fix, what to skip, what needs clarification
- **Safety** — conflict detection and resolution prompting, dry-run mode, abort controls, cost tracking
- **Continuity** — progress persistence, lifetime stats, merged PR tracking

The script handles the **what**. orc handles the **how much**, **which ones**, and **is it working**.

---

## Part 5: The Real Product — The 30,000-Foot View

> "The whole goal was to have a dashboard where I can see how branches are progressing and take actions automatically. Like Claude Code but from a 30,000 ft view where I can zoom in as needed."

This is the insight. The value isn't "AI fixes PR comments" — every competitor is converging on that. The value is:

**A control plane for concurrent AI coding sessions across your entire PR surface area.**

Today, developers using Claude Code (or Copilot, or Cursor) work on one thing at a time. If you have 5 open PRs with review feedback, you manually context-switch between them. orc lets you:

1. See all 5 PRs at a glance with status badges
2. Let the AI work on 3 of them concurrently in isolated worktrees
3. Zoom into any one to see what Claude is doing (activity pane, branch logs)
4. Intervene when needed (resolve conflicts, open shell, resume session)
5. Track costs and progress across all of them

This is closer to a **CI/CD dashboard for AI-assisted development** than a code review bot.

### Who Would Want This

- **Solo developers** with many PRs open (your current use case)
- **Tech leads** managing a team's PR queue — "show me which PRs have unresolved feedback and let me batch-fix the trivial ones"
- **Platform teams** wanting to automate the grunt work of CI fix cycles across many repos
- **Open source maintainers** drowning in contributor PRs with review feedback

### The Product Spectrum

```
Script ←————————————————————————————————→ Full SaaS
(webhook + claude)   orc (local TUI)   orc (hosted dashboard)

Less value,         Sweet spot for      Hard economics,
easy to build       power users         crowded market
```

### Recommendation

**Stay local. Stay a tool. Don't go SaaS (yet).**

Here's why:

1. **The Claude SDK cost problem is real.** A SaaS where you absorb API costs needs aggressive pricing ($50-100+/user/month) to survive. BYOK reduces friction but also reduces stickiness.

2. **The GitHub App migration is worth doing regardless.** Even for personal use, `orc[bot]` identity eliminates the fragile regex detection, prevents feedback loops structurally, and gives you a cleaner permission model. It doesn't require being a SaaS — you can distribute the app for users to self-host with their own API keys.

3. **The dashboard is the moat.** CodeRabbit, Copilot, Graphite — they're all fighting over the review/fix layer. Nobody is building the **multi-session control plane**. That's where orc's TUI already shines. A web version of this dashboard (not the fix engine, the *visibility and control layer*) is where the SaaS potential lives.

4. **The `@claude` integration point is smart.** You're right that leaning into Claude's native GitHub integration for individual fixes makes sense. orc's value-add isn't "I can call Claude Code" — anyone can do that. It's "I can orchestrate 10 Claude Code sessions across 10 PRs and show you what's happening in all of them."

### If You Did Want to Go SaaS Eventually

The path would be:

1. **Phase 1 (now)**: Ship the GitHub App for identity. Keep it self-hosted, BYOK. This is valuable for you personally and solves the feedback loop problem.

2. **Phase 2**: Build a lightweight web dashboard that shows the same data as the TUI (branch status, comment counts, CI state, costs). This could be a simple server that the local orc daemon reports to — no need to move the fix engine to the cloud.

3. **Phase 3**: If there's demand, offer a hosted version where the daemon runs in your infrastructure. Users install the GitHub App, bring their Anthropic API key (or route through Bedrock), and get the dashboard + orchestration as a service.

Phase 3 is where the SaaS economics need to work. But phases 1 and 2 are valuable regardless and let you validate demand without the cost risk.

---

## Appendix: Technical Details

### Current Auth Chain

```
User's machine
├── gh auth login → OAuth token stored in gh config
├── git credentials → system credential helper (SSH or HTTPS)
└── Claude Code → OAuth login or ANTHROPIC_API_KEY

orc uses:
├── gh CLI → inherits user's gh auth (GHClient shells out to `gh api`)
├── git push → inherits user's git credentials (GitManager runs `git push`)
└── Agent SDK → inherits user's Claude auth (FixExecutor calls `query()`)
```

### GitHub App Auth Chain (proposed)

```
orc server/daemon
├── App private key (.pem) + App ID → JWT (10-min, local crypto)
├── JWT → Installation token (1-hr, from GitHub API)
├── Installation token → GitHub API calls (replaces gh CLI)
├── Installation token → git push via x-access-token URL
└── ANTHROPIC_API_KEY → Agent SDK (unchanged, user provides own key)
```

### Key Files That Would Change

| File | Current | With GitHub App |
|---|---|---|
| `src/github/gh-client.ts` | Shells out to `gh` CLI | Octokit with installation token, or `GH_TOKEN` env |
| `src/core/comment-fetcher.ts` | `isOrcReply()` regex | `comment.author.login === "orc[bot]"` |
| `src/core/worktree-manager.ts` | `git fetch origin` with user creds | Token-injected remote URL |
| `src/core/git-manager.ts` | `git push` with user creds | `x-access-token` URL pattern |
| `src/core/daemon.ts` | `botLogin` field exists but unused for filtering | Primary identity mechanism |
| `src/types/config.ts` | No auth config | App ID, private key path, installation ID |
