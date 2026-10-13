#!/usr/bin/env bash
# Once, as the agents user: the operator's notes repo and its sync over the tailnet.
#   - <gitRoot>/notes.git (bare, server only: no GitHub mirror) and the working copy ~/notes the sync commits in
#   - first files: README.md (the index), inbox.md, ideas.md, and a .gitignore for Obsidian's per-device files
#   - the git server for Obsidian (notes-git.service beside this script, installed as <name>-notes-git), on localhost:8342
# Then, by the operator: `npm run notes-password`, and once `sudo tailscale serve --bg --https=8443 http://127.0.0.1:8342`
# to put the tailnet's HTTPS in front of it. That one command takes sudo on purpose: making this user a Tailscale
# operator would let anything running as it change the node's Tailscale settings, Funnel (public exposure) included.
set -euo pipefail
source "$(dirname "$0")/../../../scripts/lib.sh"
NAME=$(setting name)
BARE=$(setting gitRoot)/notes.git
WORK="$HOME/notes"

if [ ! -d "$BARE" ]; then
	git init --quiet --bare --initial-branch=main "$BARE"
	git -C "$BARE" config http.receivepack true
	echo "created $BARE"
fi
if [ ! -d "$WORK/.git" ]; then
	git clone --quiet "$BARE" "$WORK" 2>/dev/null || true
	cd "$WORK"
	git checkout --quiet -B main
	git config user.name "$NAME" # the sync commits the agents' writes here
	git config user.email "$NAME@localhost"
	if [ -z "$(git ls-files)" ]; then
		printf '%s\n' "# Notes" "" "The index: every file, one line each. The Notes agent keeps it current." "" "## Ideas" "- [[ideas]]: loose ideas" "" "## Links" "" "## Trips" "" "## Projects" "" "## Other" "- [[inbox]]: not sorted yet" > README.md
		printf '%s\n' "# Inbox" "" "Notes not sorted yet, each with a guess where it belongs." > inbox.md
		printf '%s\n' "# Ideas" "" > ideas.md
		printf '%s\n' ".obsidian/workspace*.json" ".obsidian/cache" ".trash/" ".DS_Store" > .gitignore
		git add -A
		git commit --quiet -m "Notes: first files"
		git push --quiet origin main
	fi
	echo "working copy $WORK"
fi

mkdir -p "$HOME/.config/systemd/user"
sed "s/@NAME@/$NAME/g" "$(dirname "$0")/notes-git.service" >"$HOME/.config/systemd/user/$NAME-notes-git.service"
systemctl --user daemon-reload
systemctl --user enable --now "$NAME-notes-git" >/dev/null
echo "notes git: $(systemctl --user is-active "$NAME-notes-git") on 127.0.0.1:8342"

if tailscale serve status 2>/dev/null | grep -q ':8443'; then
	echo "tailnet: https://$(tailscale status --self --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'):8443/notes.git"
else
	echo "tailnet HTTPS not set up yet: run once 'sudo tailscale serve --bg --https=8443 http://127.0.0.1:8342'."
fi
# The notes view every minute (the full sync, every 15, covers it too): the same lock, so a minute's run skips while
# the full one is going.
line="* * * * * flock -n /tmp/$NAME-sync.lock node $HOME/$NAME-deploy/scripts/sync.mjs --minute >> $HOME/.cache/$NAME-sync.log 2>&1"
if ! crontab -l 2>/dev/null | grep -qE 'sync.mjs --(views|minute)'; then
	node_bin="$(command -v node || true)"
	for d in "$HOME"/.local/share/pi-node/node-v2[2-9]*/bin; do [ -x "$d/node" ] && node_bin="$d/node"; done
	(crontab -l 2>/dev/null; echo "# $NAME: repo views a person edits too (the notes), every minute"; echo "${line/ node / $node_bin }") | crontab -
	echo "cron: notes sync every minute"
fi
[ -f "$HOME/.config/$NAME/notes-git.pass" ] || echo "no password yet: the operator runs 'npm run notes-password' in a terminal."
