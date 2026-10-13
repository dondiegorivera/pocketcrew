# Sourced by the shell scripts: Node 22 on the PATH (cf and the TypeScript config need it; a cron or hook PATH may find
# an older one first), and `setting <key>` for one owner setting from pocketcrew.config.ts (src/config.ts).
if ! node -e 'process.exit(+process.versions.node.split(".")[0] < 22)' 2>/dev/null; then
	for d in "$HOME"/.local/share/pi-node/node-v2[2-9]*/bin; do [ -x "$d/node" ] && PATH="$d:$PATH"; done
fi
setting() { node "$(dirname "${BASH_SOURCE[0]}")/config.mjs" "$1"; }
