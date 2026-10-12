#!/usr/bin/env bash
# One-time setup for working on Estate Inventory on a Mac (or Linux with the
# tools already installed). Run from the project folder:
#     bash setup/setup-mac.sh
# Same steps as setup-windows.ps1. Safe to run again.
set -euo pipefail
REPO="${1:-Redbaron13/estate-inventory}"
cd "$(dirname "$0")/.."

step() { printf '\n== %s\n' "$1"; }
info() { printf '   %s\n' "$1"; }
fail() { printf '\n!! %s\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

step 'Checking tools'
if [[ "$(uname)" == "Darwin" ]]; then
  have brew || fail 'Install Homebrew first: https://brew.sh'
  for pkg in git node gh deno; do have "$pkg" || brew install "$pkg"; done
  have docker || brew install --cask docker
else
  for cmd in git node gh docker; do have "$cmd" || fail "$cmd is not installed."; done
fi
node_major=$(node -v | sed -E 's/^v([0-9]+).*/\1/')
(( node_major >= 22 )) || fail "Node.js 22 or newer is needed (found $(node -v))."

step 'Checking Docker (runs the local database)'
if ! docker info >/dev/null 2>&1; then
  [[ "$(uname)" == "Darwin" ]] && open -a Docker || true
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  docker info >/dev/null 2>&1 || fail 'Docker is not running. Open Docker Desktop once, accept its terms, and run this again.'
fi
info 'Docker is running'

step 'Linking this folder to GitHub'
git config --global user.name >/dev/null || { read -rp '   Your name for commits: ' n; git config --global user.name "$n"; }
git config --global user.email >/dev/null || { read -rp '   Your email for commits: ' e; git config --global user.email "$e"; }
gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git >/dev/null 2>&1 || true
if [[ -d .git ]]; then
  info "Already linked: $(git remote get-url origin 2>/dev/null || echo 'no remote')"
elif gh repo view "$REPO" >/dev/null 2>&1; then
  git init -b main >/dev/null
  git remote add origin "https://github.com/$REPO.git"
  git fetch origin
  git reset origin/main >/dev/null      # keep files on disk; differences show in git status
  git branch --set-upstream-to=origin/main main >/dev/null
else
  git init -b main >/dev/null && git add -A && git commit -m 'Initial import' >/dev/null
  gh repo create "$REPO" --private --source . --remote origin --push
fi
git status --short | head -15

step 'Installing packages'
npm ci

step 'Starting the local database (first run downloads about 2 GB)'
npx supabase start
status=$(npx supabase status -o json)
node -e '
  const s = JSON.parse(process.argv[1]);
  require("fs").writeFileSync(".env.local",
    "# Written by setup/setup-mac.sh for the local database. Not committed.\n" +
    `VITE_SUPABASE_URL=${s.API_URL}\nVITE_SUPABASE_ANON_KEY=${s.ANON_KEY}\nVITE_APP_ENV=local\n`);
' "$status"
info '.env.local written'

step 'Ready'
cat <<'EOF'
   Start the app:      npm run dev           then open http://localhost:5173
   Demo sign-in:       alex@example.com / estate-demo-pass   (also blair@ and casey@)
   Sign-in codes:      emails land in http://127.0.0.1:54324 (local inbox)
   Run all checks:     npm run check  and  npm run db:test
EOF
