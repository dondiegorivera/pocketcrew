#!/usr/bin/env bash
# Once: the nightly cron line for scripts/backup.sh (03:30, after the agent archive at 02:45), then one backup now.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
NAME=$(setting name)
line="30 3 * * * bash $HOME/$NAME-deploy/scripts/backup.sh >> $HOME/.cache/$NAME-backup.log 2>&1"
if ! crontab -l 2>/dev/null | grep -q 'scripts/backup.sh'; then
	(crontab -l 2>/dev/null; echo "# $NAME: nightly backup of the git repos (pocketcrew.config.ts backupDir)"; echo "$line") | crontab -
	echo "cron: nightly backup at 03:30"
fi
bash "$(dirname "$0")/backup.sh"
