#!/usr/bin/env bash
# Continuous deployment. The bare repo's post-receive hook (scripts/hooks/post-receive) runs this, taken from the
# pushed commit, after every push to main. In a clean clone (~/<name>-deploy): the newest main, npm ci when the
# lockfile changed, npm run check, then the Worker and the reports site. A failed check deploys nothing. One deploy at a
# time; pushes that land meanwhile are picked up before it exits. The outcome is said in General (POST /sync/deploy).
# Log: ~/.cache/<name>-deploy/deploy.log. <name> is the instance's (pocketcrew.config.ts name), which the hook passes;
# it is also the bare repo's name (<gitRoot>/<name>.git) and the start of the hook's temporary copy of this file.
set -uo pipefail
# A hook's environment points git at the bare repo; the clone needs its own.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
case "$0" in /tmp/*-deploy-??????)
	TEMP_NAME=$(basename "$0")
	rm -f "$0" # the hook's temporary copy
	;;
esac

# The hook passes its bare repo; an older hook did not, but named its temporary copy /tmp/<name>-deploy-XXXXXX.
TEMP_NAME=${TEMP_NAME:-}
[ -n "${POCKETCREW_BARE:-}" ] || [ -n "$TEMP_NAME" ] || { echo "deploy.sh: set POCKETCREW_BARE to the bare repo (scripts/ci-setup.sh does)" >&2; exit 1; }
BARE=${POCKETCREW_BARE:-/srv/agents-git/${TEMP_NAME%-deploy-*}.git}
NAME=$(basename "$BARE" .git)
DIR="$HOME/$NAME-deploy"
STATE="$HOME/.cache/$NAME-deploy"
TOKEN_FILE="$HOME/.config/$NAME/library-export-token"
mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock 9

# cf needs Node 22; a hook's PATH may find an older one first.
if ! node -e 'process.exit(+process.versions.node.split(".")[0] < 22)' 2>/dev/null; then
	for d in "$HOME"/.local/share/pi-node/node-v2[2-9]*/bin; do [ -x "$d/node" ] && PATH="$d:$PATH"; done
fi

# Says the outcome in General. The token goes in a RAM-only header file, never on a command line.
notify() {
	[ -s "$TOKEN_FILE" ] || return 0
	# The Worker's address from the clone's config (pocketcrew.config.ts url), as of the code being deployed.
	local hdr URL=${POCKETCREW_URL:-$(cd "$DIR" 2>/dev/null && node scripts/config.mjs url 2>/dev/null)}
	[ -n "$URL" ] || return 0
	hdr=$(umask 077 && mktemp /dev/shm/deploy-XXXXXX) || return 0
	printf 'authorization: Bearer %s\n' "$(cat "$TOKEN_FILE")" >"$hdr"
	# $3: the shipped commits' titles, one per line, for the Lead's week of news (src/news.ts).
	node -e 'process.stdout.write(JSON.stringify({ ok: process.argv[1] === "1", text: process.argv[2], changes: (process.argv[3] ?? "").split("\n").filter(Boolean) }))' "$1" "$2" "${3:-}" |
		curl -s -m 20 -X POST -H @"$hdr" -H 'content-type: application/json' --data-binary @- "$URL/sync/deploy" >/dev/null
	rm -f "$hdr"
}
fail() { # sha stage output
	printf '%s\n' "$3" >"$STATE/last-failure.log"
	local why
	why=$(printf '%s\n' "$3" | grep -E 'error|Error|not ok|✘|failed' | grep -v '^#' | head -4 | cut -c1-200)
	notify 0 "Deploy of ${1:0:7} stopped at ${2}; what is live did not change.${why:+
$why}"
	echo "$(date -u +%FT%TZ) ${1:0:7} failed at $2"
}

if [ ! -d "$DIR/.git" ]; then
	git clone --quiet "$BARE" "$DIR" || exit 1
fi
cd "$DIR" || exit 1

while :; do
	git fetch --quiet origin || exit 1
	sha=$(git rev-parse origin/main)
	last=$(cat "$STATE/deployed" 2>/dev/null || true)
	[ "$sha" = "$last" ] && exit 0
	[ "$sha" = "$(cat "$STATE/failed" 2>/dev/null || true)" ] && exit 0 # already reported; the next push retries
	echo "$(date -u +%FT%TZ) ${sha:0:7} deploying"
	git reset --quiet --hard "$sha" && git clean --quiet -fd

	lockhash=$(sha256sum package-lock.json | cut -c1-64)
	if [ ! -d node_modules ] || [ "$lockhash" != "$(cat "$STATE/lock-hash" 2>/dev/null || true)" ]; then
		if ! out=$(npm ci --no-audit --no-fund 2>&1); then fail "$sha" "npm ci" "$out"; echo "$sha" >"$STATE/failed"; exit 1; fi
		echo "$lockhash" >"$STATE/lock-hash"
	fi
	ln -sfn ../../node_modules sites/reports/node_modules
	npx cf auth activate "$NAME" "$DIR" >/dev/null 2>&1 || true

	if ! out=$(npm run check 2>&1); then fail "$sha" "the checks" "$out"; echo "$sha" >"$STATE/failed"; continue; fi
	if ! out=$(npm run deploy 2>&1); then fail "$sha" "the Worker upload" "$out"; echo "$sha" >"$STATE/failed"; continue; fi
	if ! out=$(npm run deploy:site 2>&1); then fail "$sha" "the reports site upload" "$out"; echo "$sha" >"$STATE/failed"; continue; fi

	echo "$sha" >"$STATE/deployed"
	# The dashboard serves from this clone: restart it onto the new code, if it is installed and running.
	XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" systemctl --user try-restart "$NAME-dashboard" >/dev/null 2>&1 || true
	XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" systemctl --user try-restart "$NAME-notes-git" >/dev/null 2>&1 || true
	n=$( [ -n "$last" ] && git rev-list --count "$last..$sha" 2>/dev/null || echo 1)
	shipped=$( { [ -n "$last" ] && git log --format=%s "$last..$sha" 2>/dev/null; } || git log -1 --format=%s "$sha")
	notify 1 "Deployed ${sha:0:7}: $(git log -1 --format=%s "$sha")$([ "${n:-1}" -gt 1 ] && echo " (+$((n - 1)) earlier commit$([ "$n" -gt 2 ] && echo s))")" "$(printf '%s\n' "$shipped" | head -30)"
	echo "$(date -u +%FT%TZ) ${sha:0:7} deployed"
done
