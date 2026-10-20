#!/usr/bin/env bash
# Desktop widget build (CLAUDE.md "Desktop widget"): the `widget` branch (widget-mode code on top of main),
# kept in a persistent worktree at $WIDGET_DIR/build, merged with main, built for the local portal and
# installed into $WIDGET_DIR/app. The running widget polls app/widget-build.txt and reloads itself when it
# changes (the run is saved on pagehide). Run by the post-commit / post-merge / post-rewrite hooks on main;
# by hand: npm run widget:install. A merge conflict leaves the installed build alone (see install.log).
# --wip builds the repo's working tree (uncommitted changes included) instead of the widget worktree.
# Usage: scripts/widget-install.sh [--force] [--wip]
set -euo pipefail
# Git hooks export GIT_DIR / GIT_INDEX_FILE (relative to main's checkout); git -C into the widget worktree must not inherit them.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX GIT_COMMON_DIR
REPO=$(cd "$(dirname "$0")/.." && cd "$(git rev-parse --git-common-dir)/.." && pwd)
DIR=${WIDGET_DIR:-$HOME/.local/share/core-protocol-widget}
B=$DIR/build
FORCE=0
WIP=0
for a in "$@"; do case $a in --force) FORCE=1 ;; --wip) WIP=1 FORCE=1 ;; esac; done
mkdir -p "$DIR"
exec 9>"$DIR/install.lock"
flock 9

if [ $WIP = 1 ]; then
  SRC=$REPO
  HASH="main@$(git -C "$REPO" rev-parse --short HEAD)+wip"
else
  SRC=$B
if ! git -C "$B" rev-parse --git-dir >/dev/null 2>&1; then
  rm -rf "$B"
  git -C "$REPO" worktree prune
  git -C "$REPO" worktree add "$B" widget >/dev/null 2>&1
fi
[ -e "$B/node_modules" ] || ln -s "$REPO/node_modules" "$B/node_modules"
if [ -n "$(git -C "$B" status --porcelain --untracked-files=no)" ]; then
  echo "widget: $B has uncommitted changes, building it without merging main"
elif ! git -C "$B" merge --no-edit -q main >/dev/null 2>&1; then
  git -C "$B" merge --abort 2>/dev/null || true
  echo "widget: merging main into widget conflicts — resolve it in $B; installed build kept" >&2
  exit 1
fi

HASH="$(git -C "$B" rev-parse --short HEAD) main@$(git -C "$REPO" rev-parse --short main)"
fi
if [ $FORCE = 0 ] && [ "$(cut -d' ' -f1,2 "$DIR/app/widget-build.txt" 2>/dev/null)" = "$HASH" ]; then
  echo "widget: $HASH already installed"
  exit 0
fi
(cd "$SRC" && VITE_PORTAL=local npx --no vite build --logLevel error && node tools/postbuild.mjs >/dev/null)
echo "$HASH $(date -Iseconds)" >"$SRC/dist/local/widget-build.txt"
rm -rf "$DIR/app.new" && cp -r "$SRC/dist/local" "$DIR/app.new"
rm -rf "$DIR/app.old" && { [ -d "$DIR/app" ] && mv "$DIR/app" "$DIR/app.old" || true; } && mv "$DIR/app.new" "$DIR/app" && rm -rf "$DIR/app.old"
echo "widget: installed $(cat "$DIR/app/widget-build.txt") ($(du -sh "$DIR/app" | cut -f1))"
