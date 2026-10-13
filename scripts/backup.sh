#!/usr/bin/env bash
# Nightly, as the agents user (cron, see scripts/backup-setup.sh): every bare repo in the git root (pocketcrew.config.ts
# gitRoot) copied to the backup folder (backupDir, a large data disk here): the notes, the private archive and every
# project.
#   - mirrors/<repo>.git: an up-to-date copy (fetch without prune: a deleted branch stays in the backup)
#   - daily/<date>/<repo>.bundle for the server-only repos (notes, <name>-private), kept 30 days like the archive's
#     own bundles, so a bad change or a force-push can be undone from an older day
# Nothing leaves the machine. The sync reports a backup older than two days in the morning briefing.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
SRC=$(setting gitRoot)
DEST=${POCKETCREW_BACKUP_DIR:-$(setting backupDir)}
[ -n "$DEST" ] || { echo "backup: no backupDir in pocketcrew.config.ts" >&2; exit 1; }
NAME=$(setting name)
STAMP="$HOME/.cache/$NAME-backup/last-ok"
mkdir -p "$DEST" 2>/dev/null || true
[ -w "$DEST" ] || { echo "backup: $DEST is missing or not writable" >&2; exit 1; }
mkdir -p "$DEST/mirrors" "$DEST/daily" "$(dirname "$STAMP")"
failed=()
for repo in "$SRC"/*.git; do
	name=$(basename "$repo")
	if [ -d "$DEST/mirrors/$name" ]; then
		git -C "$DEST/mirrors/$name" fetch --quiet --force origin '+refs/*:refs/*' || failed+=("$name")
	else
		git clone --quiet --mirror "$repo" "$DEST/mirrors/$name" || failed+=("$name")
	fi
done
day="$DEST/daily/$(date +%F)"
mkdir -p "$day"
for name in notes "$NAME-private"; do
	[ -d "$SRC/$name.git" ] && git -C "$SRC/$name.git" bundle create --quiet "$day/$name.bundle" --all
done
find "$DEST/daily" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
# One unreadable repo (another user's) does not stop the rest; it is named in the stamp, which the sync reports.
printf '%s %s\n' "$(date -u +%FT%TZ)" "${failed[*]:-}" >"$STAMP"
echo "backup: $(ls "$DEST/mirrors" | wc -l) repos mirrored, bundles in $day${failed:+; failed: ${failed[*]}}"
