#!/usr/bin/env bash
# One-time (and safe to rerun) setup of the research archive, as the agents user on this server:
#   - the bare repo <gitRoot>/<name>-research.git (<name>: pocketcrew.config.ts name), mirrored to a private GitHub repo as a backup
#   - its working copy ~/<name>-research, where scripts/sync.mjs writes reports and pages
#   - the private archive: the bare repo <gitRoot>/<name>-private.git with NO GitHub mirror (it holds reports
#     built from mail, calendar and docs, and the fleet's state) and its working copy ~/<name>-private
#   - ~/<name>-sync, a clone of the code repo where scripts/sync.mjs commits skills saved in chat
#   - the export token: a random value in ~/.config/<name> (mode 600) and the same value as the Worker's
#     LIBRARY_EXPORT_TOKEN secret, passed to a deploy through /dev/shm and never printed
#   - a cron line that syncs every 15 minutes
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh
ROOT=$(setting gitRoot)
NAME=$(setting name)

BARE=$ROOT/$NAME-research.git
WORK="$HOME/$NAME-research"
# Optional private GitHub mirror of the research archive, as owner/repo; without it the archive stays on this server.
GITHUB=${POCKETCREW_RESEARCH_MIRROR:-}
TOKEN_FILE="$HOME/.config/$NAME/library-export-token"

if [ ! -d "$BARE" ]; then
	git init --quiet --bare --initial-branch=main "$BARE"
	if [ -n "$GITHUB" ]; then
		git -C "$BARE" remote add github "https://github.com/$GITHUB.git"
		git -C "$BARE" config --unset-all remote.github.fetch || true # mirror only our refs
		cp "$ROOT/$NAME.git/hooks/post-receive" "$BARE/hooks/post-receive"
	fi
	echo "bare repo $BARE created"
fi
[ -z "$GITHUB" ] || gh repo view "$GITHUB" >/dev/null 2>&1 || gh repo create "$GITHUB" --private --description "$NAME research library (backup mirror)" >/dev/null
if [ ! -d "$WORK/.git" ]; then
	git clone --quiet "$BARE" "$WORK"
	git -C "$WORK" checkout --quiet -B main
	# The sync commits as the same author as this repo.
	git -C "$WORK" config user.name "$(git config user.name)"
	git -C "$WORK" config user.email "$(git config user.email)"
fi
if ! git -C "$WORK" rev-parse --verify --quiet HEAD >/dev/null; then
	printf '# Research library\n\nReports the %s fleet filed. Synced by scripts/sync.mjs.\n' "$NAME" >"$WORK/INDEX.md"
	git -C "$WORK" add INDEX.md
	git -C "$WORK" commit --quiet -m "Research library"
	git -C "$WORK" push --quiet -u origin main
	echo "working copy $WORK created"
fi

PRIVATE_BARE=$ROOT/$NAME-private.git
PRIVATE_WORK="$HOME/$NAME-private"
if [ ! -d "$PRIVATE_BARE" ]; then
	git init --quiet --bare --initial-branch=main "$PRIVATE_BARE"
	chmod 700 "$PRIVATE_BARE"
	echo "bare repo $PRIVATE_BARE created (server only, no mirror)"
fi
if [ ! -d "$PRIVATE_WORK/.git" ]; then
	git clone --quiet "$PRIVATE_BARE" "$PRIVATE_WORK" 2>/dev/null
	chmod 700 "$PRIVATE_WORK"
	git -C "$PRIVATE_WORK" checkout --quiet -B main
	git -C "$PRIVATE_WORK" config user.name "$(git config user.name)"
	git -C "$PRIVATE_WORK" config user.email "$(git config user.email)"
fi
if ! git -C "$PRIVATE_WORK" rev-parse --verify --quiet HEAD >/dev/null; then
	printf '# Private archive\n\nServer only, never mirrored. Synced by scripts/sync.mjs.\n' >"$PRIVATE_WORK/INDEX.md"
	git -C "$PRIVATE_WORK" add INDEX.md
	git -C "$PRIVATE_WORK" commit --quiet -m "Private archive"
	git -C "$PRIVATE_WORK" push --quiet -u origin main
	echo "working copy $PRIVATE_WORK created"
fi

if [ ! -d "$HOME/$NAME-sync/.git" ]; then
	git clone --quiet "$ROOT/$NAME.git" "$HOME/$NAME-sync"
	git -C "$HOME/$NAME-sync" config user.name "$(git config user.name)"
	git -C "$HOME/$NAME-sync" config user.email "$(git config user.email)"
	echo "skill sync clone ~/$NAME-sync created"
fi

if [ ! -s "$TOKEN_FILE" ]; then
	mkdir -p "$(dirname "$TOKEN_FILE")" && chmod 700 "$(dirname "$TOKEN_FILE")"
	(umask 077 && openssl rand -hex 32 >"$TOKEN_FILE")
	# Where the Worker reads secrets (Secrets Store or Worker secrets), like scripts/secrets.sh does.
	file=$(mktemp /dev/shm/secret-XXXXXX) && trap 'rm -f "$file"' EXIT
	printf '{"LIBRARY_EXPORT_TOKEN":"%s"}' "$(cat "$TOKEN_FILE")" >"$file"
	node scripts/put-secrets.mjs "$file" --deploy >/dev/null
	echo "export token created and set"
fi

line="*/15 * * * * flock -n /tmp/$NAME-sync.lock node $PWD/scripts/sync.mjs >> $HOME/.cache/$NAME-sync.log 2>&1"
node_bin=$(command -v node)
line="${line/ node / $node_bin }"
if ! crontab -l 2>/dev/null | grep -qE "$NAME[a-z-]*/scripts/sync.mjs( |$)"; then
	mkdir -p "$HOME/.cache"
	# Replaces the line of the earlier library-sync.mjs, if there is one.
	(crontab -l 2>/dev/null; echo "# $NAME: library and skills → git"; echo "$line") | crontab -
	echo "cron line added"
fi
echo "library setup done"
