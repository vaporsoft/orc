#!/usr/bin/env bash
set -euo pipefail

# release.sh — bump version, publish to npm, create GitHub release
#
# Usage: ./scripts/release.sh <patch|minor|major>
#
# Steps:
#   1. Validate working tree is clean
#   2. Bump version in package.json (npm version)
#   3. Push commit + tag
#   4. Publish to npm (build runs via prepublishOnly hook)
#   5. Generate release notes with Claude Code from commit diff
#   6. Create GitHub release

BUMP="${1:-}"
if [[ -z "$BUMP" || ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 <patch|minor|major>"
  exit 1
fi

# Confirmation prompt
read -r -p "This will publish a new $BUMP revision to npm and GitHub. Are you sure you want to proceed? [y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# Ensure clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Ensure we're on main
BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: releases must be cut from main (currently on '$BRANCH')."
  exit 1
fi

# Verify npm auth before doing anything
if ! npm whoami &>/dev/null; then
  echo "Error: not authenticated with npm. Run 'npm login' first."
  exit 1
fi

# Get previous version tag before bumping
PREV_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo "")"

# Bump version — creates commit + tag (e.g. v0.2.0)
# npm version outputs the new version prefixed with "v"
NEW_VERSION="$(npm version "$BUMP" --message "%s" --no-git-tag-version)"
VERSION_NUMBER="${NEW_VERSION#v}"

echo "Bumped to $NEW_VERSION"

# Commit and tag
git add package.json
git commit -m "$VERSION_NUMBER"
git tag "$NEW_VERSION"

# Push commit + tag first (so publish failure is recoverable)
git push
git push origin "$NEW_VERSION"

# Publish to npm (build runs via prepublishOnly hook)
if ! npm publish; then
  echo ""
  echo "Error: npm publish failed. Rolling back version bump..."
  git push origin --delete "$NEW_VERSION" 2>/dev/null || true
  git tag -d "$NEW_VERSION" 2>/dev/null || true
  git reset --hard HEAD~1
  git push --force-with-lease
  echo "Rolled back to $(git describe --tags --abbrev=0 2>/dev/null || echo 'previous state')."
  exit 1
fi

# Generate release notes with Claude Code
echo "Generating release notes with Claude Code..."

if [[ -n "$PREV_TAG" ]]; then
  COMMITS="$(git log --oneline "$PREV_TAG".."$NEW_VERSION" -- . ':!node_modules')"
  DIFF_STAT="$(git diff --stat "$PREV_TAG".."$NEW_VERSION" -- . ':!node_modules')"
else
  COMMITS="$(git log --oneline "$NEW_VERSION" -- . ':!node_modules')"
  DIFF_STAT="$(git diff --stat --root "$NEW_VERSION" -- . ':!node_modules')"
fi

PROMPT="You are writing GitHub release notes for version $NEW_VERSION of orc, an interactive terminal dashboard that automates PR feedback loops.

Previous version: ${PREV_TAG:-"(initial release)"}

Commits in this release:
$COMMITS

Diff stat:
$DIFF_STAT

Write concise, user-facing release notes in markdown. Group changes under headings like Features, Fixes, Improvements as appropriate. Skip internal chores/refactors unless they meaningfully affect users. Keep it brief — a few bullet points per section. Do not include a title heading (the GitHub release title handles that). Do not wrap the output in a code block."

RELEASE_NOTES="$(claude -p "$PROMPT" --output-format text)"

echo ""
echo "=== Release Notes ==="
echo "$RELEASE_NOTES"
echo "====================="
echo ""

# Create GitHub release
gh release create "$NEW_VERSION" \
  --title "$NEW_VERSION" \
  --notes "$RELEASE_NOTES"

echo ""
echo "Done! Published $NEW_VERSION"
echo "  npm: https://www.npmjs.com/package/@vaporsoft/orc/v/$VERSION_NUMBER"
echo "  GitHub: $(gh release view "$NEW_VERSION" --json url -q .url)"
