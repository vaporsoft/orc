# Keybinding Redesign

## Goal

Rework the TUI keybindings around a consistent spatial navigation model: right = go deeper, left = go back, enter = primary action for context. Add fullscreen section takeover, contextual key hints, and streamlined fix/stop actions.

## Navigation Model

```
Session List ──→──▶ Detail Panel ──→──▶ Expand Section Inline
     ◀──←──              ◀──←──

In Detail: ↑/↓ navigate sections
On a section: enter = fullscreen takeover
In fullscreen: q/esc = back to detail
```

## Complete Keybinding Map

### Navigation

| Key | Action | Context |
|-----|--------|---------|
| `j` / `k` | Select prev/next PR | Always (session list) |
| `→` | Open detail panel | Session list, detail closed |
| `←` | Close detail panel | Detail panel open |
| `↑` / `↓` | Navigate sections | Detail panel open |
| `→` | Expand section inline | Section focused in detail |
| `←` | Collapse section inline | Section expanded in detail |
| `enter` | Fullscreen section takeover | Section focused in detail |
| `q` / `esc` | Exit fullscreen section | In fullscreen section view |

### Fix & Stop Actions

| Key | Action |
|-----|--------|
| `enter` | Fix + Address selected branch (context: session list, detail closed) |
| `shift+enter` | Fix + Address all branches |
| `F` (shift+f) | Fix CI all branches |
| `A` (shift+a) | Address comments all branches |
| `x` | Stop selected branch |
| `X` (shift+x) | Stop all branches |
| `w` | Watch selected branch |

### Tools

| Key | Action |
|-----|--------|
| `e` | Open worktree shell |
| `E` (shift+e) | Open shell with Claude resume |
| `l` | Toggle logs (returns to previous view on second press) |
| `tab` | Toggle all-logs pane |

### Global

| Key | Action |
|-----|--------|
| `h` | Help/legend |
| `,` | Settings |
| `t` | Toggle theme |
| `q` | Quit (when not in fullscreen section) |
| `+` | Add branch |
| `d` | Clear merged PRs |

## Changes from Current

### Removed

- `f` (fix CI single) — enter covers fix+address for selected branch
- `a` (address comments single) — enter covers fix+address for selected branch
- `s` (stop single) — replaced by `x`
- `c` (claude resume) — merged into `E`
- `space` (collapse/expand section) — replaced by `→`/`←` on sections
- `*` (fix all) — replaced by `shift+enter`

### Changed

- `enter`: "toggle detail" → "fix+address" (session list) or "fullscreen section" (detail view)
- `x`: "stop all" → "stop selected" (`X` = stop all)
- `F`: "fix+address single" → "fix CI all"
- `A`: was unused → "address comments all"

### New

- `→`/`←` for detail open/close and section expand/collapse
- `E` for shell + claude resume
- Fullscreen section takeover mode (enter on focused section)
- `F` fix CI all, `A` address comments all

## Enter Key Disambiguation

`enter` is context-sensitive:

- **Session list (detail closed):** Fix + Address selected branch
- **Detail panel (section focused):** Fullscreen that section
- **Toolbar focused:** Activate button
- **Modal open:** Confirm/select

## Contextual Key Hints

Hints in the help bar update based on current view state:

- **Session list (no detail):** `enter fix · → details · l logs`
- **Detail open:** `← close · ↑↓ sections · → expand · enter focus · l logs`
- **Section fullscreen:** `q close · ↑↓ scroll`
- **Logs view:** `l close · ↑↓ scroll`

The `←` close hint only appears when detail is open. Fullscreen section hints only appear in fullscreen mode.

## Logs Toggle Behavior

`l` remembers the previous view and returns to it:

- Session list → branch logs → press `l` → back to session list
- Detail view → branch logs → press `l` → back to detail view
- Fullscreen section → branch logs → press `l` → back to fullscreen section

Uses existing `detailModeBeforeLogs` pattern, extended to also track fullscreen section state.
