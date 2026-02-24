# Keybinding Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework TUI keybindings to use a spatial navigation model (right/left for deeper/back, enter for primary action), add fullscreen section takeover, contextual hints, and streamlined fix/stop actions.

**Architecture:** All keybinding logic lives in `src/tui/App.tsx` useInput handler. Hints live in `src/tui/components/DetailPanel.tsx` (inline) and `src/tui/components/HelpBar.tsx` (bottom bar). Legend modal is `src/tui/components/KeybindLegend.tsx`. We add a new `fullscreenSection` state to App, wire new key mappings, and update all hint/legend components.

**Tech Stack:** TypeScript, React 18, Ink (terminal UI framework)

**Design doc:** `docs/plans/2026-02-24-keybinding-redesign-design.md`

---

### Task 1: Add fullscreen section state to App

**Files:**
- Modify: `src/tui/App.tsx:43-51` (state declarations)

**Step 1: Add fullscreenSection state**

Add after the `collapsedSections` state declaration (line 51):

```typescript
const [fullscreenSection, setFullscreenSection] = useState<DetailSection | null>(null);
```

**Step 2: Verify build**

Run: `yarn build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/tui/App.tsx
git commit -m "feat: add fullscreenSection state for section takeover mode"
```

---

### Task 2: Remap fix/address actions (enter and shift variants)

**Files:**
- Modify: `src/tui/App.tsx:215-334` (keybinding handlers)

This task replaces the old `f`, `F`, `a`, `*` fix actions with the new mapping:
- `enter` (session list, detail closed, no fullscreen) = fix+address selected branch
- `shift+enter` = fix+address all
- `F` (shift+f) = fix CI all
- `A` (shift+a) = address comments all

**Step 1: Remove old fix/address keybindings**

Delete these blocks from the useInput handler:

1. The `f` handler (lines 216-222): `if (input === "f" && focusedPane === "sessions")`
2. The `F` handler (lines 225-231): `if (input === "F" && focusedPane === "sessions")`
3. The `a` handler (lines 312-318): `if (input === "a" && focusedPane === "sessions")`
4. The `*` handler (lines 321-326): `if (input === "*")`

**Step 2: Remove old stop single keybinding**

Delete the `s` handler (lines 294-300): `if (input === "s" && focusedPane === "sessions")`

**Step 3: Remove old `c` keybinding (claude resume)**

Delete the `c` handler (lines 337-348): `if (input === "c" && focusedPane === "sessions")`

**Step 4: Remap the enter key**

Replace the current enter handler (lines 278-284) with context-sensitive behavior:

```typescript
// Enter: context-sensitive primary action
if ((key.return || input === "\n") && focusedPane === "sessions") {
  if (fullscreenSection) {
    // In fullscreen section — enter does nothing (q/esc to exit)
    return;
  }
  if (detailMode === "detail" && visibleSections.length > 0) {
    // Detail open with focused section — enter fullscreen
    const section = (focusedSection && visibleSections.includes(focusedSection))
      ? focusedSection
      : visibleSections[0];
    if (section) {
      setFullscreenSection(section);
    }
    return;
  }
  // Session list (detail closed or no sections) — fix + address
  const branch = openBranches[clampedSessionIndex];
  if (branch && !daemon.isRunning(branch)) {
    daemon.startBranch(branch, "once", "all").catch(() => {});
  }
  return;
}
```

**Step 5: Add shift+enter handler**

Add right after the enter handler:

```typescript
// Shift+Enter: fix + address all branches
if (key.return && key.shift) {
  daemon.startAll("once", "all").catch((err) => {
    logger.error(`startAll failed: ${err}`);
  });
  return;
}
```

Note: the shift+enter check must come BEFORE the regular enter check in the handler, since Ink's key object has `key.return = true` for both. Reorder so shift+enter is first.

**Step 6: Add F (shift+f) and A (shift+a) handlers**

```typescript
// F (shift+f): fix CI all branches
if (input === "F") {
  daemon.startAll("once", "ci").catch((err) => {
    logger.error(`startAll failed: ${err}`);
  });
  return;
}

// A (shift+a): address comments all branches
if (input === "A") {
  daemon.startAll("once", "comments").catch((err) => {
    logger.error(`startAll failed: ${err}`);
  });
  return;
}
```

**Step 7: Remap x to stop selected, X to stop all**

Replace the existing `x` handler:

```typescript
// x: stop selected branch
if (input === "x" && focusedPane === "sessions") {
  const branch = openBranches[clampedSessionIndex];
  if (branch && daemon.isRunning(branch)) {
    daemon.stopBranch(branch).catch(() => {});
  }
  return;
}

// X (shift+x): stop all branches
if (input === "X") {
  daemon.stopAll().catch((err) => {
    logger.error(`stopAll failed: ${err}`);
  });
  return;
}
```

**Step 8: Remap E (shift+e) to claude resume, keep e as shell**

The `e` handler stays as-is. Add `E` handler right after it:

```typescript
// E (shift+e): open shell with Claude resume
if (input === "E" && focusedPane === "sessions") {
  const branch = openBranches[clampedSessionIndex];
  const entry = branch ? entries.get(branch) : undefined;
  const st = entry?.state;
  if (st?.lastSessionId && st.workDir) {
    openTerminal(`cd ${shellEscape(st.workDir)} && claude --resume ${shellEscape(st.lastSessionId)}`);
    logger.info(`Resuming Claude session ${st.lastSessionId}`, branch);
  } else {
    logger.warn("No Claude session to resume for this branch", branch);
  }
  return;
}
```

**Step 9: Update toolbar "Fix All" button**

In the `toolbarButtons` array (line 146), change the "Fix All" action from `"ci"` to `"all"`:

```typescript
{ label: "Fix All", action: () => daemon.startAll("once", "all").catch((err) => logger.error(`startAll failed: ${err}`)) },
```

**Step 10: Verify build**

Run: `yarn build`
Expected: Clean compilation

**Step 11: Commit**

```bash
git add src/tui/App.tsx
git commit -m "feat: remap fix/stop/tool keybindings to new scheme"
```

---

### Task 3: Add right/left arrow navigation for detail open/close and section expand/collapse

**Files:**
- Modify: `src/tui/App.tsx` (useInput handler and arrow key sections)

**Step 1: Add right arrow handler for opening detail and expanding sections**

Add this before the existing arrow key navigation block (before line 408). Must come after toolbar arrow handling but before the general arrow section:

```typescript
// Right arrow: open detail or expand section
if (key.rightArrow && focusedPane === "sessions" && toolbarIndex < 0) {
  if (fullscreenSection) {
    // In fullscreen — right does nothing
    return;
  }
  if (detailMode === "detail" && visibleSections.length > 0) {
    // Detail open — expand (uncollapse) focused section
    const section = (focusedSection && visibleSections.includes(focusedSection))
      ? focusedSection
      : visibleSections[0];
    if (section && collapsedSections.has(section)) {
      setCollapsedSections((prev) => {
        const next = new Set(prev);
        next.delete(section);
        return next;
      });
    }
    return;
  }
  if (detailMode !== "detail") {
    // Session list — open detail panel
    setFocusedSection(null);
    setDetailMode("detail");
    return;
  }
  return;
}

// Left arrow: close detail or collapse section
if (key.leftArrow && focusedPane === "sessions" && toolbarIndex < 0) {
  if (fullscreenSection) {
    // In fullscreen — left exits fullscreen
    setFullscreenSection(null);
    return;
  }
  if (detailMode === "detail" && visibleSections.length > 0) {
    // Detail open — collapse focused section, or close detail if already collapsed
    const section = (focusedSection && visibleSections.includes(focusedSection))
      ? focusedSection
      : visibleSections[0];
    if (section && !collapsedSections.has(section)) {
      setCollapsedSections((prev) => {
        const next = new Set(prev);
        next.add(section);
        return next;
      });
      return;
    }
    // Section already collapsed (or no section) — close detail panel
    setDetailMode("off");
    return;
  }
  if (detailMode === "detail") {
    // Detail open but no sections — just close
    setDetailMode("off");
    return;
  }
  return;
}
```

**Step 2: Remove old space handler for collapse/expand**

Delete the space handler (lines 365-382): `if (input === " " && focusedPane === "sessions" && detailMode === "detail"...)`

**Step 3: Remove old enter toggle for detail**

The enter key was already replaced in Task 2. Verify the old `setDetailMode((prev) => prev === "detail" ? "off" : "detail")` logic is gone.

**Step 4: Add q/esc to exit fullscreen section**

Add near the top of the useInput handler (after modal blocking check, before `q` quit):

```typescript
// Fullscreen section: q or esc exits back to detail
if (fullscreenSection && (input === "q" || key.escape)) {
  setFullscreenSection(null);
  return;
}
```

This must come BEFORE the global `q` quit handler so `q` exits fullscreen instead of quitting the app.

**Step 5: Verify build**

Run: `yarn build`
Expected: Clean compilation

**Step 6: Commit**

```bash
git add src/tui/App.tsx
git commit -m "feat: add spatial arrow navigation for detail/sections and fullscreen exit"
```

---

### Task 4: Render fullscreen section in App

**Files:**
- Modify: `src/tui/App.tsx:458-526` (render section)
- Modify: `src/tui/components/DetailPanel.tsx` (add FullscreenSection component or export section rendering)

**Step 1: Add fullscreenSection prop to DetailPanel**

Add to `DetailPanelProps` interface:

```typescript
fullscreenSection?: DetailSection | null;
```

**Step 2: Create fullscreen rendering mode in DetailPanel**

In the `DetailPanel` component, after the early return for `!entry`, add a fullscreen render path:

```typescript
// Fullscreen section view
if (fullscreenSection && visibleSections.includes(fullscreenSection)) {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.accent}
      borderTop={false}
      borderBottom={false}
      paddingX={1}
      paddingTop={1}
      flexGrow={1}
      flexDirection="column"
    >
      <Box marginLeft={2}>
        <Text dimColor>
          <Text color={theme.accent}>q</Text> close · <Text color={theme.accent}>esc</Text> close
        </Text>
      </Box>
      {/* Render just the one section, never collapsed */}
      {/* ... section content for fullscreenSection ... */}
    </Box>
  );
}
```

The fullscreen view should render the selected section's content without collapse logic (always expanded) and with a `flexGrow={1}` to fill available space. Increase the MAX constants for fullscreen (e.g. show all items, no truncation, or a much higher limit).

To avoid duplicating section rendering logic, extract the section content into small helper components or just use the existing rendering blocks with `isCollapsed` always returning `false`. The simplest approach: when `fullscreenSection` is set, render only that one section header + content with `isCollapsed` forced to `false`, and bump max visible items.

**Step 3: Pass fullscreenSection and update App render**

In App.tsx, when `fullscreenSection` is set, hide the SessionList and show only the DetailPanel in fullscreen mode:

```typescript
{!fullscreenSection && (
  <SessionList
    entries={entries}
    selectedIndex={clampedSessionIndex}
    focused={focusedPane === "sessions" && toolbarIndex < 0}
    openBranches={openBranches}
    mergedBranches={mergedBranches}
    isDiscovering={isDiscovering}
  />
)}
{detailMode !== "logs" && (
  <DetailPanel
    entries={entries}
    selectedBranch={selectedBranch}
    showDetail={detailMode === "detail"}
    activityLines={activityLines}
    focusedSection={detailMode === "detail" ? focusedSection : null}
    collapsedSections={collapsedSections}
    fullscreenSection={fullscreenSection}
  />
)}
```

Also hide the LogPane and "All Logs" pane when in fullscreen mode.

**Step 4: Verify build**

Run: `yarn build`
Expected: Clean compilation

**Step 5: Manual test**

Run: `yarn build && node bin/orc.ts`
Test: press `→` to open detail, `↑/↓` to navigate sections, `enter` to fullscreen a section, `q` to exit fullscreen, `←` to close detail.

**Step 6: Commit**

```bash
git add src/tui/App.tsx src/tui/components/DetailPanel.tsx
git commit -m "feat: add fullscreen section takeover rendering"
```

---

### Task 5: Update contextual hints in HelpBar and DetailPanel

**Files:**
- Modify: `src/tui/components/HelpBar.tsx`
- Modify: `src/tui/components/DetailPanel.tsx:222-265` (inline hints)
- Modify: `src/tui/App.tsx` (pass context to HelpBar)

**Step 1: Make HelpBar context-aware**

Add props to HelpBar:

```typescript
interface HelpBarProps {
  detailMode: "off" | "detail" | "logs";
  fullscreenSection: DetailSection | null;
}
```

Update the HelpBar render to show different hints based on state:

```typescript
export function HelpBar({ detailMode, fullscreenSection }: HelpBarProps) {
  const theme = useTheme();

  let hints: { k: string; label: string }[];

  if (fullscreenSection) {
    hints = [
      { k: "q", label: "close" },
      { k: "esc", label: "close" },
    ];
  } else if (detailMode === "logs") {
    hints = [
      { k: "l", label: "close" },
      { k: "↑↓", label: "scroll" },
      { k: "h", label: "help" },
    ];
  } else if (detailMode === "detail") {
    hints = [
      { k: "←", label: "close" },
      { k: "↑↓", label: "sections" },
      { k: "→", label: "expand" },
      { k: "enter", label: "focus" },
    ];
  } else {
    hints = [
      { k: "enter", label: "fix" },
      { k: "→", label: "details" },
      { k: "l", label: "logs" },
      { k: "h", label: "help" },
    ];
  }

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      paddingX={1}
      justifyContent="center"
      gap={1}
    >
      {hints.map((hint, i) => (
        <React.Fragment key={hint.k + hint.label}>
          {i > 0 && <Text dimColor>·</Text>}
          <Key k={hint.k} label={hint.label} accentColor={theme.accent} />
        </React.Fragment>
      ))}
    </Box>
  );
}
```

**Step 2: Pass context from App to HelpBar**

In App.tsx render:

```typescript
<HelpBar detailMode={detailMode} fullscreenSection={fullscreenSection} />
```

**Step 3: Update inline hints in DetailPanel**

Update the collapsed view hints (line 222-224):

```typescript
<Text dimColor>
  <Text color={theme.accent}>enter</Text> fix · <Text color={theme.accent}>x</Text> stop · <Text color={theme.accent}>w</Text> watch · <Text color={theme.accent}>→</Text> details
  {commentCount > 0 && <Text color={theme.warning}> · {commentCount} unresolved</Text>}
</Text>
```

Update the expanded view hints (line 259-264):

```typescript
<Text dimColor>
  <Text color={theme.accent}>enter</Text> fix · <Text color={theme.accent}>x</Text> stop · <Text color={theme.accent}>w</Text> watch · <Text color={theme.accent}>←</Text> close
  {effectiveFocusedSection && <Text> · <Text color={theme.accent}>→</Text> expand · <Text color={theme.accent}>enter</Text> focus</Text>}
  {commentCount > 0 && <Text color={theme.warning}> · {commentCount} unresolved</Text>}
</Text>
```

Wait — there's an ambiguity: in the expanded detail view, `enter` is shown for both "fix" and "focus". The user's intent is that `enter` means "focus section" when detail is open. So the collapsed (no detail) view shows `enter fix` and the expanded (detail) view shows `enter focus`:

Collapsed view:
```
enter fix · x stop · w watch · → details
```

Expanded view:
```
← close · ↑↓ sections · → expand · enter focus
```

**Step 4: Update ErrorAction hints**

In `ErrorAction` component (line 105), update the action hints:

```typescript
hints.push("enter to fix · x to stop · w to watch");
```

And update `c` references to `E`:
```typescript
hints.push("l to check logs for details");
hints.push("E to resume Claude session");
```

**Step 5: Verify build**

Run: `yarn build`
Expected: Clean compilation

**Step 6: Commit**

```bash
git add src/tui/App.tsx src/tui/components/HelpBar.tsx src/tui/components/DetailPanel.tsx
git commit -m "feat: update contextual key hints for new keybinding scheme"
```

---

### Task 6: Update KeybindLegend modal

**Files:**
- Modify: `src/tui/components/KeybindLegend.tsx:15-53`

**Step 1: Update the keybinding groups**

Replace the `getGroups` function:

```typescript
function getGroups(showingLogs: boolean): KeybindGroup[] {
  return [
    {
      title: "Navigation",
      binds: [
        { key: "j/k", label: "Select PR" },
        { key: "→", label: "Open details / expand section" },
        { key: "←", label: "Close details / collapse section" },
        { key: "↑/↓", label: "Navigate sections (in detail)" },
        { key: "enter", label: "Fullscreen section (in detail)" },
        { key: "q/esc", label: "Exit fullscreen section" },
        { key: "l", label: "Branch logs (toggle)" },
        { key: "tab", label: showingLogs ? "Hide all logs" : "All logs" },
      ],
    },
    {
      title: "Actions",
      binds: [
        { key: "+", label: "Add branch" },
        { key: "enter", label: "Fix + Address" },
        { key: "⇧ enter", label: "Fix + Address all" },
        { key: "F", label: "Fix CI all" },
        { key: "A", label: "Address all" },
        { key: "x", label: "Stop" },
        { key: "X", label: "Stop all" },
        { key: "w", label: "Watch" },
        { key: "d", label: "Clear merged" },
      ],
    },
    {
      title: "Tools",
      binds: [
        { key: "e", label: "Open shell" },
        { key: "E", label: "Resume Claude" },
        { key: "t", label: "Toggle theme" },
        { key: ",", label: "Settings" },
      ],
    },
  ];
}
```

**Step 2: Verify build**

Run: `yarn build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/tui/components/KeybindLegend.tsx
git commit -m "feat: update keybind legend for new keybinding scheme"
```

---

### Task 7: Update logs toggle to preserve fullscreen state

**Files:**
- Modify: `src/tui/App.tsx` (logs toggle handler and state)

**Step 1: Save and restore fullscreen section on log toggle**

The current `l` handler toggles between detail and logs. It needs to also save/restore `fullscreenSection`:

Add a new state to save fullscreen before logs:

```typescript
const [fullscreenBeforeLogs, setFullscreenBeforeLogs] = useState<DetailSection | null>(null);
```

Update the `l` handler:

```typescript
if (input === "l" && focusedPane === "sessions") {
  if (detailMode === "logs") {
    // Returning from logs — restore previous state
    setDetailMode(detailModeBeforeLogs);
    setFullscreenSection(fullscreenBeforeLogs);
  } else {
    // Entering logs — save current state
    setDetailModeBeforeLogs(detailMode);
    setFullscreenBeforeLogs(fullscreenSection);
    setFullscreenSection(null);
    setDetailMode("logs");
  }
  setBranchLogOffset(0);
  return;
}
```

Also update the `tab` handler to save/restore fullscreen:

```typescript
if (key.tab) {
  setFocusedPane((prev) => {
    if (prev === "sessions") {
      setDetailModeBeforeLogs(detailMode);
      setFullscreenBeforeLogs(fullscreenSection);
      setFullscreenSection(null);
      setDetailMode("off");
      return "logs";
    } else {
      setDetailMode(detailModeBeforeLogs);
      setFullscreenSection(fullscreenBeforeLogs);
      return "sessions";
    }
  });
  return;
}
```

**Step 2: Verify build**

Run: `yarn build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/tui/App.tsx
git commit -m "feat: preserve fullscreen section state across log toggles"
```

---

### Task 8: Block irrelevant keys during fullscreen section

**Files:**
- Modify: `src/tui/App.tsx` (useInput handler)

**Step 1: Block session-level actions in fullscreen mode**

After the fullscreen `q`/`esc` exit handler, add a guard that blocks actions that don't make sense in fullscreen mode:

```typescript
// In fullscreen section: block most actions, only allow q/esc (above), l (logs toggle), h (help), `,` (settings)
if (fullscreenSection) {
  // Allow: l (logs toggle), h (help), , (settings), t (theme), tab
  // Block everything else by returning early
  if (input === "l" || input === "h" || input === "," || input === "t" || key.tab) {
    // Fall through to normal handlers below
  } else {
    return;
  }
}
```

Place this after the fullscreen q/esc handler and before the fix/stop action handlers.

**Step 2: Verify build**

Run: `yarn build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/tui/App.tsx
git commit -m "feat: block irrelevant keybindings during fullscreen section"
```

---

### Task 9: Final integration test and cleanup

**Files:**
- Modify: `src/tui/App.tsx` (if any issues found)
- Modify: `src/tui/components/DetailPanel.tsx` (if any issues found)

**Step 1: Build and lint**

Run: `yarn build && yarn lint && yarn typecheck`
Expected: All clean

**Step 2: Manual testing checklist**

Run: `yarn build && node bin/orc.ts`

Test each keybinding:
- [ ] `j`/`k` — navigate PRs
- [ ] `→` — open detail panel
- [ ] `←` — close detail panel
- [ ] `↑`/`↓` — navigate sections in detail
- [ ] `→` on focused section — expand inline
- [ ] `←` on focused section — collapse inline
- [ ] `←` on collapsed section — close detail
- [ ] `enter` on session list (no detail) — fix+address
- [ ] `enter` on section in detail — fullscreen takeover
- [ ] `q`/`esc` in fullscreen — exit to detail
- [ ] `shift+enter` — fix+address all
- [ ] `F` — fix CI all
- [ ] `A` — address all
- [ ] `x` — stop selected
- [ ] `X` — stop all
- [ ] `w` — watch
- [ ] `e` — open shell
- [ ] `E` — claude resume
- [ ] `l` — toggle logs (returns to previous view)
- [ ] `l` from fullscreen — logs then back to fullscreen
- [ ] `tab` — all logs toggle
- [ ] `h` — legend shows correct keys
- [ ] Hints update based on view state
- [ ] `+`, `d`, `,`, `t` — unchanged behaviors work

**Step 3: Fix any issues found**

Address build errors, visual glitches, or keybinding conflicts discovered during testing.

**Step 4: Final commit (if needed)**

```bash
git add -A
git commit -m "fix: address issues found during keybinding integration testing"
```
