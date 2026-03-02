# Diff Summary Per Branch

## Overview

Add additions/deletions/changed files stats to each PR row and detail panel. Data is fetched inline with existing GitHub GraphQL PR queries.

## Data Layer

- Add `additions?: number`, `deletions?: number`, `changedFiles?: number` to `GHPullRequest` in `src/github/types.ts`
- Add those three fields to `MY_OPEN_PRS_QUERY`, `BROWSE_OPEN_PRS_QUERY`, `SEARCH_OPEN_PRS_QUERY` in `src/github/queries.ts`

## UI — Row Column

- New "Diff" column in `SessionRow.tsx` (~16 chars wide)
- Format: `+N -N (F)` — green additions, red deletions, dim file count
- Numbers >= 1000 use `k` suffix (e.g., `+1.2k`)
- Show `—` when data not yet available

## UI — Detail Panel

- Add diff stats line in `DetailPanel.tsx`: `+120 additions, -45 deletions, 12 files changed`

## UI — Header

- Add "Diff" label to header row in `SessionList.tsx`

## Approach

Extend `GHPullRequest` directly (approach A). No new daemon maps, events, or hooks. Data travels with the PR object and refreshes on every PR poll cycle.
