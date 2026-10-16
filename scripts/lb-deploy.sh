#!/usr/bin/env bash
# Deploy the leaderboard Worker (server/): first-time setup and repeat deploys, idempotent.
#
#   scripts/lb-deploy.sh           create what is missing (D1, secrets), migrate, deploy, health-check
#   scripts/lb-deploy.sh status    read-only: login, D1, secrets, Worker health
#
# Run once before the first time:  cd server && npx wrangler login
# The very first deploy on an account must register its workers.dev subdomain: run the script in a terminal
# (wrangler is then run interactively for that one step), or once by hand:  cd server && npx wrangler deploy
# Several Cloudflare accounts: export CLOUDFLARE_ACCOUNT_ID=<id>.
#
# Secrets are generated here (openssl rand -base64 32) and only created when absent. An existing secret is
# never overwritten: changing DAILY_SECRET changes the daily seeds. ADMIN_TOKEN is also written to
# server/verifier/verifier.env (git-ignored, chmod 600) together with LB_URL.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD
INTERACTIVE=0; [[ -t 0 && -t 1 ]] && INTERACTIVE=1
TOML=$ROOT/server/wrangler.toml
VENV=$ROOT/server/verifier/verifier.env
DB_NAME=core-protocol-lb
WORKER=core-protocol-lb
SITE=core-protocol          # the static preview site (tools/deploy-pages.sh)
PLACEHOLDER_ID=00000000-0000-0000-0000-000000000000
SECRETS=(ADMIN_TOKEN DAILY_SECRET RUN_SECRET)

created=()
existed=()

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
wr() { (cd "$ROOT/server" && npx --no-install wrangler "$@"); }

for tool in jq openssl curl; do
  command -v "$tool" >/dev/null || die "$tool is required"
done
[[ -x server/node_modules/.bin/wrangler ]] || { say "installing server dependencies..."; (cd server && npm install --silent); }

check_login() {
  wr whoami --json >/dev/null 2>&1 \
    || die "not logged in to Cloudflare. Run:  cd server && npx wrangler login   (then run this script again)"
}

db_id_in_toml() { sed -n 's/^database_id *= *"\([^"]*\)".*/\1/p' "$TOML" | head -1; }

# id of the remote D1 database named $DB_NAME ("" if none)
db_id_remote() { wr d1 list --json 2>/dev/null | jq -r --arg n "$DB_NAME" '[.[] | select(.name == $n)][0].uuid // empty'; }

# names of the Worker's secrets; fails (non-zero, nothing printed) if wrangler or its JSON fails, so that a
# failed listing is never mistaken for "no secrets" and existing secrets are never overwritten
secret_names() {
  local js
  js=$(wr secret list --name "$WORKER" --format json 2>/dev/null) || return 1
  jq -e 'type == "array"' >/dev/null 2>&1 <<<"$js" || return 1
  jq -r '.[].name' <<<"$js"
}

# set KEY=VALUE in an env file (replace the line or append), keeping the file private
env_set() {
  local file=$1 key=$2 val=$3
  [[ -f $file ]] || { cp "$ROOT/server/verifier/verifier.env.example" "$file"; }
  if grep -q "^$key=" "$file"; then
    # '|' as sed delimiter: base64 contains '/', never '|'
    sed -i "s|^$key=.*|$key=$val|" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
  chmod 600 "$file"
}

health() {
  local url=$1
  curl -fsS --max-time 15 "$url/v1/health" 2>/dev/null
}

status() {
  check_login
  say "login:   ok"
  local id rid
  id=$(db_id_in_toml); rid=$(db_id_remote)
  say "D1:      toml=$id remote=${rid:-<missing>}"
  say "secrets: $(secret_names | tr '\n' ' ' || echo '<could not list>')"
  if [[ -f $VENV ]] && grep -q '^LB_URL=https' "$VENV"; then
    local url; url=$(sed -n 's/^LB_URL=//p' "$VENV")
    say "health:  $url -> $(health "$url" || echo 'no answer')"
  else
    say "health:  LB_URL is not in verifier.env yet (deploy first)"
  fi
}

[[ "${1:-}" == status ]] && { status; exit 0; }
[[ $# -eq 0 ]] || die "usage: scripts/lb-deploy.sh [status]"

check_login
say "logged in to Cloudflare."

# --- 1. D1 database -------------------------------------------------------------------------------------
id=$(db_id_in_toml)
if [[ $id == "$PLACEHOLDER_ID" || -z $id ]]; then
  rid=$(db_id_remote)
  if [[ -n $rid ]]; then
    existed+=("D1 $DB_NAME ($rid, found in the account)")
  else
    say "creating D1 database $DB_NAME..."
    wr d1 create "$DB_NAME" --no-update-config >/dev/null
    rid=$(db_id_remote)
    [[ -n $rid ]] || die "D1 database was created but its id was not found (wrangler d1 list --json)"
    created+=("D1 $DB_NAME ($rid)")
  fi
  sed -i "s|^database_id *=.*|database_id = \"$rid\"|" "$TOML"
  say "wrangler.toml: database_id = $rid"
else
  existed+=("D1 $DB_NAME ($id, already in wrangler.toml)")
fi

# --- 2. migrations (idempotent: only unapplied ones run) ------------------------------------------------
say "applying D1 migrations..."
(cd server && npm run --silent db:migrate:remote)

# --- 3. Worker (first, so that `secret put` has a Worker to attach to) ----------------------------------
# Sets $url. Not used in $(...): wrangler's output goes to the terminal live (tee) and is kept in a log.
# The first deploy on an account needs the workers.dev subdomain registered, which wrangler only asks for on a
# TTY; with piped output it fails, so that one run gets the terminal and the deploy is then repeated.
DEPLOY_LOG=$(mktemp); trap 'rm -f "$DEPLOY_LOG"' EXIT
deploy() {
  if ! wr deploy 2>&1 | tee "$DEPLOY_LOG" >&2; then
    grep -qi 'workers\.dev subdomain' "$DEPLOY_LOG" || die "wrangler deploy failed (output above)"
    (( INTERACTIVE )) || die "this account has no workers.dev subdomain yet. Register it once in a terminal:  cd server && npx wrangler deploy   (then run this script again)"
    say "registering the account's workers.dev subdomain (wrangler asks)..."
    wr deploy </dev/tty >/dev/tty 2>&1 || die "wrangler deploy (subdomain registration) failed"
    wr deploy 2>&1 | tee "$DEPLOY_LOG" >&2 || die "wrangler deploy failed (output above)"
  fi
  url=$(grep -o "https://$WORKER\.[a-z0-9-]*\.workers\.dev" "$DEPLOY_LOG" | head -1 || true)
}

say "deploying the Worker..."
deploy
[[ -n $url ]] || die "could not find the workers.dev URL in the wrangler output above"

# --- 4. CORS: the static site's origin (same account subdomain as the Worker) ----------------------------
# CORS patterns only support a leading "*." and a trailing ":*", so the site gets its exact origin.
sub=${url#"https://$WORKER."}
site_origin="https://$SITE.$sub"
if grep -qF "$site_origin" "$TOML"; then
  existed+=("CORS origin $site_origin")
else
  sed -i "s|^\(CORS_ORIGINS *= *\"[^\"]*\)\"|\1,$site_origin\"|" "$TOML"
  grep -qF "$site_origin" "$TOML" || die "could not add $site_origin to CORS_ORIGINS in server/wrangler.toml"
  created+=("CORS origin $site_origin")
  say "redeploying with the new CORS origin..."
  deploy
fi

# --- 5. secrets -----------------------------------------------------------------------------------------
have=$(secret_names) || die "could not list the Worker's secrets (wrangler secret list); not creating any, so none is overwritten"
admin_new=""
for name in "${SECRETS[@]}"; do
  if grep -qx "$name" <<<"$have"; then
    existed+=("secret $name")
    continue
  fi
  val=$(openssl rand -base64 32)
  printf '%s' "$val" | wr secret put "$name" --name "$WORKER" >/dev/null || die "wrangler secret put $name failed"
  created+=("secret $name")
  # saved right away: if a later put fails the script stops, and this value would otherwise be lost
  if [[ $name == ADMIN_TOKEN ]]; then admin_new=$val; env_set "$VENV" ADMIN_TOKEN "$val"; fi
done

# --- 6. verifier.env ------------------------------------------------------------------------------------
env_set "$VENV" LB_URL "$url"
if [[ -n $admin_new ]]; then
  env_set "$VENV" ADMIN_TOKEN "$admin_new"
  created+=("server/verifier/verifier.env (LB_URL, ADMIN_TOKEN)")
elif ! grep -q '^ADMIN_TOKEN=.\+' "$VENV"; then
  say "warning: ADMIN_TOKEN already exists on the Worker but is not in verifier.env; put it there by hand,"
  say "         or replace it: openssl rand -base64 32 | tee /dev/stderr | (cd server && npx wrangler secret put ADMIN_TOKEN)"
fi

# --- 7. health ------------------------------------------------------------------------------------------
say
if h=$(health "$url"); then
  say "health:  $url/v1/health -> $h"
else
  say "health:  $url/v1/health did not answer yet (retry in a few seconds)"
fi

say
say "Leaderboard Worker: $url"
say "Site origin allowed: $site_origin"
say "Created:        ${created[*]:+$(printf '%s; ' "${created[@]}")}"
say "Already existed: ${existed[*]:+$(printf '%s; ' "${existed[@]}")}"
say
say "Next: VITE_LEADERBOARD_URL=$url in .env.production.local, then tools/deploy-pages.sh (site) and"
say "      server/verifier/README.md steps 2-3 (register builds, install the verifier)."
