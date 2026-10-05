#!/usr/bin/env bash
# Dev preview on GitHub Pages (branch gh-pages): the local-portal build (no SDK), noindex + robots.txt.
# Usage: tools/deploy-pages.sh   (needs push access to origin)
set -euo pipefail
cd "$(dirname "$0")/.."
npm test --silent
PAGES=1 VITE_PORTAL=local npx vite build --logLevel warn
printf 'User-agent: *\nDisallow: /\n' > dist/local/robots.txt
touch dist/local/.nojekyll
tmp=$(mktemp -d)
cp -r dist/local/. "$tmp"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Pages preview $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f "$(cd - >/dev/null && git remote get-url origin)" gh-pages
echo "deployed to gh-pages"
