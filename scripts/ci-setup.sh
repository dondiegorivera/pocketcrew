#!/usr/bin/env bash
# One-time (and safe to rerun): continuous deployment, as the user that runs the instance on this server.
#   - installs scripts/hooks/post-receive into the bare repo: every push to main deploys (scripts/deploy.sh)
#   - runs the first deploy, which creates the clean clone ~/<name>-deploy (<name>: pocketcrew.config.ts name)
#   - points the 15-minute sync cron at that clone, so the sync that runs is the code that is deployed
#   - installs and starts the dashboard (deploy/systemd/dashboard.service as <name>-dashboard), served from that clone
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh
NAME=$(setting name)
BARE=$(setting gitRoot)/$NAME.git

install -m 775 scripts/hooks/post-receive "$BARE/hooks/post-receive"
echo "hook installed in $BARE"

POCKETCREW_BARE=$BARE bash scripts/deploy.sh
echo "deployed: $(cat "$HOME/.cache/$NAME-deploy/deployed" 2>/dev/null || echo none; true)"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
mkdir -p "$HOME/.config/systemd/user"
sed "s/@NAME@/$NAME/g" deploy/systemd/dashboard.service >"$HOME/.config/systemd/user/$NAME-dashboard.service"
systemctl --user daemon-reload
systemctl --user enable --now "$NAME-dashboard" >/dev/null
systemctl --user restart "$NAME-dashboard"
echo "dashboard: $(systemctl --user is-active "$NAME-dashboard") on port 8341"

# A sync cron that still runs from this checkout moves to the deployed clone, so the sync that runs is the deployed code.
if crontab -l 2>/dev/null | grep -qF "$PWD/scripts/sync.mjs"; then
	crontab -l | sed "s#$PWD/scripts/sync.mjs#$HOME/$NAME-deploy/scripts/sync.mjs#" | crontab -
	echo "sync cron now runs from ~/$NAME-deploy"
fi
