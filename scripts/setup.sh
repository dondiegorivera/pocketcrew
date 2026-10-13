#!/usr/bin/env bash
# npm run setup: a new pocketcrew from a fresh clone, step by step, in a terminal. Safe to rerun: a step that is done says
# so, and Enter keeps every value already set.
#   1. Node 22 and the packages   2. Cloudflare sign-in   3. settings (pocketcrew.config.ts)
#   4. the Telegram bot and group, the secrets, the deploy and the webhook (scripts/secrets.sh)
#   5. what is left: /setup in the group, and the optional parts (reports site, Google, home server)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh
[[ -t 0 ]] || { echo "Run this in an interactive terminal: it asks questions and reads secrets from the keyboard." >&2; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
pause() { read -rp "$1 Press Enter when done. " _; }

step "1/5 Node.js and packages"
node -e 'process.exit(+process.versions.node.split(".")[0] < 22)' 2>/dev/null || { echo "pocketcrew needs Node.js 22 or newer (https://nodejs.org); this shell has $(node -v 2>/dev/null || echo none)." >&2; exit 1; }
[ -d node_modules ] || npm ci
echo "✓ Node $(node -v), packages installed"

step "2/5 Cloudflare"
if npx cf auth whoami >/dev/null 2>&1; then
	echo "✓ signed in"
else
	echo "A free Cloudflare account is enough to start (https://dash.cloudflare.com/sign-up); heavier use may need Workers Paid"
	echo "(5 USD a month). Signing in opens a browser."
	npx cf auth login
fi

step "3/5 Settings"
if grep -q 'example.workers.dev' pocketcrew.config.ts || [[ "$(read -rp 'Settings exist. Change them? [y/N] ' a; echo "${a:-n}")" == [yY]* ]]; then
	node scripts/setup-config.mjs
fi
node scripts/bundle-plugins.mjs >/dev/null
echo "✓ $(setting url)"

step "4/5 Telegram, secrets, deploy"
cat <<'EOF'
You need, once:
  - an Anthropic API key: https://console.anthropic.com → API keys (set a monthly limit there too)
  - a Telegram bot: talk to @BotFather, /newbot, copy the token. Then /mybots → your bot → Bot Settings →
    Group Privacy → Turn off, so it reads the group.
  - a Telegram group with Topics on (group settings → Topics), with the bot added as an admin. The agents get one
    topic each; General is where you talk to the Lead.
EOF
pause "Have the key, the bot and the group ready."
bash scripts/secrets.sh --first

step "5/5 Last steps"
cat <<EOF
✓ The Worker runs at $(setting url) and the bot listens.
  - In the group's General topic, send /setup: it makes one topic per agent. Then /help.
  - Try it: "what can you do?" in General.
Optional, any time:
  - Published pages for the phone (reports site): put a Cloudflare Access application in front of
    $(setting reportsUrl), set reportsAccess in pocketcrew.config.ts, then npm run deploy:site.
  - Google (google plugin): npm run google, then /google connect in General.
  - A home server (any always-on Linux box) keeps the archives in git, syncs notes and repo views and deploys on push:
    bash scripts/library-setup.sh, then bash scripts/ci-setup.sh. Without it the fleet still runs; only the git side waits.
EOF
