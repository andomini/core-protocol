#!/usr/bin/env bash
# Dev preview site on Cloudflare: the local-portal build (no portal SDK) as a static-assets-only Worker
# "core-protocol" (https://core-protocol.<account-subdomain>.workers.dev). noindex meta + robots.txt Disallow
# until the official launch. Needs `cd server && npx wrangler login` once (scripts/lb-deploy.sh checks it).
# Leaderboard: VITE_LEADERBOARD_URL from the environment or .env.production.local is baked into the build.
# The site's origin must be in CORS_ORIGINS of the leaderboard Worker (scripts/lb-deploy.sh adds it).
# Usage: tools/deploy-pages.sh
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD

if [[ -z "${VITE_LEADERBOARD_URL:-}" ]] && ! grep -qs '^VITE_LEADERBOARD_URL=.\+' .env.production.local .env.local .env 2>/dev/null; then
  echo "warning: VITE_LEADERBOARD_URL is not set (env or .env.production.local): the build will have no leaderboards" >&2
fi

npm test --silent
# PAGES=1 only adds the noindex meta tag (asset paths are relative in every build).
PAGES=1 npm run build:local --silent
printf 'User-agent: *\nDisallow: /\n' > dist/local/robots.txt

[[ -d server/node_modules ]] || (cd server && npm install --silent)
out=$(cd server && npx wrangler deploy --config "$root/tools/site.wrangler.toml" 2>&1 | tee /dev/stderr)
url=$(grep -o 'https://core-protocol\.[a-z0-9-]*\.workers\.dev' <<<"$out" | head -1 || true)
echo
echo "deployed: ${url:-<see the wrangler output above>}"
if [[ -n "$url" ]]; then
  echo "CORS: the leaderboard Worker must allow the origin $url (scripts/lb-deploy.sh adds it and redeploys)."
fi
