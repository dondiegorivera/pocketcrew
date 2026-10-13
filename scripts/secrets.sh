#!/usr/bin/env bash
# Sets the fleet's secrets (in the account's Secrets Store once src/secrets.ts names it, else as Worker secrets),
# deploys, and points the Telegram webhook at the Worker.
# Run it yourself in a terminal (it reads secrets without echoing them); never paste secrets into an agent chat.
#   npm run secrets        everything
#   npm run google         only the Google OAuth client
# Press Enter at a prompt to keep the value already set. --first (npm run setup): a new bot, so find its group.
set -euo pipefail
cd "$(dirname "$0")/.."

# cf needs Node 22+. A non-interactive shell (sudo -iu agents bash -c ...) skips .bashrc, where Node 22 joins PATH.
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if (($(node_major) < 22)); then
	for bin in "$HOME"/.local/share/pi-node/node-v2[2-9]*/bin; do [[ -x "$bin/node" ]] && PATH="$bin:$PATH"; done
	(($(node_major) >= 22)) || { echo "cf needs Node.js 22 or newer; this shell has $(node -v 2>/dev/null || echo none)." >&2; exit 1; }
fi

[[ -t 0 ]] || { echo "Run this in an interactive terminal: it reads secrets from the keyboard." >&2; exit 1; }

ask() { # ask VAR "prompt": reads without echo into VAR, and says whether something arrived
	local value
	read -rsp "$2: " value
	echo
	if [[ -n "$value" ]]; then echo "  ✓ received (${#value} characters)"; else echo "  – kept as it is"; fi
	printf -v "$1" '%s' "$value"
}
echo "Paste each value and press Enter. Hidden prompts show nothing while you paste; that is expected."

# Bot API call with the token in curl's config on stdin, not on the command line where `ps` would show it.
tgapi() { # tgapi method [curl -d args...]
	local method=$1
	shift
	curl -fsS -K - "$@" <<<"url = \"https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}\""
}

ANTHROPIC_API_KEY="" TELEGRAM_BOT_TOKEN="" TELEGRAM_CHAT_ID="" TELEGRAM_USER_ID="" TELEGRAM_WEBHOOK_SECRET=""
if [[ "${1:-}" != --google ]]; then
	ask ANTHROPIC_API_KEY "Anthropic API key (sk-ant-..., Enter to keep)"
	ask TELEGRAM_BOT_TOKEN "Telegram bot token from @BotFather (Enter to keep)"
fi
GOOGLE_CLIENT_ID="" GOOGLE_CLIENT_SECRET=""
read -rp "Google OAuth client ID (…apps.googleusercontent.com, Enter to keep): " GOOGLE_CLIENT_ID
if [[ -n "$GOOGLE_CLIENT_ID" ]]; then
	[[ "$GOOGLE_CLIENT_ID" == *.apps.googleusercontent.com ]] || { echo "That does not look like a client ID." >&2; exit 1; }
	ask GOOGLE_CLIENT_SECRET "Google OAuth client secret"
	[[ -n "$GOOGLE_CLIENT_SECRET" ]] || { echo "The client ID needs its secret." >&2; exit 1; }
fi

GITHUB_TOKEN=""
CF_ANALYTICS_TOKEN=""
if [[ "${1:-}" != --google ]]; then
	ask GITHUB_TOKEN "GitHub fine-grained token, public repositories read-only (github_pat_..., Enter to keep)"
	ask CF_ANALYTICS_TOKEN "Cloudflare API token of the sites' account, Zone Read + Analytics Read (Enter to keep)"
fi

new_group=n
[[ "${1:-}" == --first ]] && new_group=y
[[ -n "$TELEGRAM_BOT_TOKEN" && "$new_group" != y ]] && read -rp "A new bot or a new group? Then I find the group again [y/N]: " new_group
if [[ -n "$TELEGRAM_BOT_TOKEN" ]]; then
	TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
fi
if [[ "$new_group" == [yY]* && -z "$TELEGRAM_BOT_TOKEN" ]]; then
	echo "Finding the group needs the bot token; run again and paste it." >&2
	exit 1
fi
if [[ "$new_group" == [yY]* ]]; then
	# A new bot: find the group and the operator from a message sent there, before the webhook takes the updates.
	tgapi deleteWebhook >/dev/null
	echo "Now write any message in the group's General topic (the bot must be an admin there). Waiting up to 60 s..."
	ids=""
	for _ in $(seq 12); do
		# Long poll; the reply lists what the bot saw, so a miss says why instead of just failing.
		ids=$(tgapi getUpdates -d timeout=5 | node -e '
			const ms = JSON.parse(require("fs").readFileSync(0, "utf8")).result.map((r) => r.message ?? (r.my_chat_member && { chat: r.my_chat_member.chat })).filter(Boolean);
			const m = ms.filter((x) => x.chat.type === "supergroup" && x.from).at(-1);
			if (m) console.log(`ok ${m.chat.id} ${m.from.id} ${m.chat.is_forum ? "forum" : "no-topics"} ${JSON.stringify(m.chat.title)}`);
			else console.log(`seen ${ms.map((x) => `${x.chat.type}:${JSON.stringify(x.chat.title ?? "direct message")}`).join(", ") || "nothing"}`);
		')
		[[ "$ids" == ok* ]] && break
	done
	if [[ "$ids" != ok* ]]; then
		echo "No message from a supergroup reached the bot. What it saw: ${ids#seen }" >&2
		echo "  'group:...' means Topics are off (turning them on makes it a supergroup). 'nothing' means the bot is not an admin" >&2
		echo "  there, or privacy mode hides the message: @BotFather > /mybots > your bot > Bot Settings > Group Privacy > Turn off." >&2
		exit 1
	fi
	read -r _ TELEGRAM_CHAT_ID TELEGRAM_USER_ID forum title <<<"$ids"
	[[ "$forum" == forum ]] || { echo "The group $title has Topics turned off. Turn them on in the group settings and run this again." >&2; exit 1; }
	echo "Group $title (chat $TELEGRAM_CHAT_ID), operator user $TELEGRAM_USER_ID."
fi

# Secrets live in RAM only, readable by this user alone. Through the environment, not the command line.
secrets=$(mktemp -p /dev/shm secrets.XXXXXX.json)
chmod 600 "$secrets"
trap 'rm -f "$secrets"' EXIT
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" \
TELEGRAM_USER_ID="$TELEGRAM_USER_ID" TELEGRAM_WEBHOOK_SECRET="$TELEGRAM_WEBHOOK_SECRET" \
GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" GITHUB_TOKEN="$GITHUB_TOKEN" CF_ANALYTICS_TOKEN="$CF_ANALYTICS_TOKEN" node -e '
	const names = ["ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_USER_ID", "TELEGRAM_WEBHOOK_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_TOKEN", "CF_ANALYTICS_TOKEN"];
	require("fs").writeFileSync(process.argv[1], JSON.stringify(Object.fromEntries(names.filter((n) => process.env[n]).map((n) => [n, process.env[n]]))));
' "$secrets"

# On a fresh account the deploy asks for a workers.dev subdomain, which needs a TTY: put-secrets keeps stdin.
node scripts/put-secrets.mjs "$secrets" --deploy

# The Worker points the webhook at itself with the secret it now holds; its answer is the webhook's state.
url=$(node scripts/config.mjs url)
until curl -fsS --max-time 10 "$url/telegram/webhook"; do echo "Waiting for $url ..."; sleep 5; done
echo
[[ -n "$GOOGLE_CLIENT_ID" ]] && echo "Google is set up: send /google connect in General."
echo "Write /setup in the group's General topic if new topics are due."
