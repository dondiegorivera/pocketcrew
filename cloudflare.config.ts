// Deployed with the project-local cf CLI (an auth profile can be bound to this directory): npm run deploy. The Worker
// is named after the instance (pocketcrew.config.ts name).
import { bindings, defineConfig, exports } from "cf/config";
import { CONFIG } from "./src/config.ts";
import { STORE_ID, STORE_PREFIX } from "./src/secrets.ts";

// Every secret comes from the account's Secrets Store once STORE_ID is set (src/secrets.ts), else it is a Worker secret.
const secret = (name: string) => (STORE_ID ? bindings.secretsStoreSecret({ storeId: STORE_ID, secretName: `${STORE_PREFIX}${name}` }) : bindings.secret());

export default defineConfig({
	worker: {
		name: CONFIG.name,
		compatibilityDate: "2026-10-01",
		compatibilityFlags: ["nodejs_compat"],
		entrypoint: "src/worker.ts",
		// One public URL, the one the Telegram webhook uses; no per-version preview URLs.
		workersDev: true,
		previewUrls: false,
		// Logs only: traces would record Telegram API URLs, which contain the bot token.
		observability: { logs: { enabled: true } },
		exports: {
			FleetAgent: exports.durableObject({ storage: "sqlite" }),
			Director: exports.durableObject({ storage: "sqlite" }),
			Library: exports.durableObject({ storage: "sqlite" }),
			Google: exports.durableObject({ storage: "sqlite" }),
			Repos: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			FleetAgent: bindings.durableObject({ worker: CONFIG.name, exportName: "FleetAgent" }),
			Director: bindings.durableObject({ worker: CONFIG.name, exportName: "Director" }),
			Library: bindings.durableObject({ worker: CONFIG.name, exportName: "Library" }),
			Google: bindings.durableObject({ worker: CONFIG.name, exportName: "Google" }),
			Repos: bindings.durableObject({ worker: CONFIG.name, exportName: "Repos" }),
			// Workers AI: Whisper for voice notes. Billed by Cloudflare per audio minute, not from the Anthropic credit.
			AI: bindings.ai(),
			// Where published pages are read: the reports Worker (sites/reports), behind Cloudflare Access.
			REPORTS_URL: bindings.text(CONFIG.reportsUrl),
			// This Worker's own address: the Google sign-in redirects back to it.
			PUBLIC_URL: bindings.text(CONFIG.url),
			// Set by the operator with `npm run secrets`, never from a file in this repo.
			ANTHROPIC_API_KEY: secret("ANTHROPIC_API_KEY"),
			TELEGRAM_BOT_TOKEN: secret("TELEGRAM_BOT_TOKEN"),
			TELEGRAM_WEBHOOK_SECRET: secret("TELEGRAM_WEBHOOK_SECRET"),
			TELEGRAM_CHAT_ID: secret("TELEGRAM_CHAT_ID"),
			TELEGRAM_USER_ID: secret("TELEGRAM_USER_ID"),
			// Bearer for the GET /library/* sync paths (src/sync-export.ts), held by the server's git sync (scripts/sync.mjs).
			LIBRARY_EXPORT_TOKEN: secret("LIBRARY_EXPORT_TOKEN"),
			// Google OAuth client (scripts/google-secrets.sh) and the key that seals the refresh token at rest.
			GOOGLE_CLIENT_ID: secret("GOOGLE_CLIENT_ID"),
			GOOGLE_CLIENT_SECRET: secret("GOOGLE_CLIENT_SECRET"),
			GOOGLE_TOKEN_KEY: secret("GOOGLE_TOKEN_KEY"),
			// Fine-grained GitHub token, public repositories read-only, for the GitHub MCP server (src/mcp.ts).
			GITHUB_TOKEN: secret("GITHUB_TOKEN"),
			// Cloudflare API token from the account that holds the sites: Zone Read and Analytics Read only (src/sites.ts).
			CF_ANALYTICS_TOKEN: secret("CF_ANALYTICS_TOKEN"),
		},
	},
});
