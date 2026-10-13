// Your settings for this pocketcrew instance; src/config.ts lists every one with its default. `npm run setup` fills in the
// addresses. Plugins listed here are compiled in (scripts/bundle-plugins.mjs); everything else in plugins/ stays out.
import type { Config } from "./src/config.ts";

export default {
	// Names your Worker (<name>.<subdomain>.workers.dev), its secrets, its Gmail label and its folders on a server.
	name: "pocketcrew",
	reportsWorker: "pocketcrew-reports",
	plugins: ["google", "web", "notes", "ops", "lead-pipeline"],
	timeZone: "Europe/Berlin",
	quietHours: [22, 7],
	briefingHour: 10,
	briefingLatestHour: 11,
	inboxHour: 18,
	nightlyHour: 22,
	// What the Anthropic Console shows: the credit or monthly budget the fleet paces itself on, and when it ends.
	credit: { usd: 100, asOf: "2026-10-01T00:00:00Z", expires: "2026-11-01T00:00:00Z" },
	url: "https://pocketcrew.example.workers.dev",
	reportsUrl: "https://pocketcrew-reports.example.workers.dev",
	reportsAccess: { teamDomain: "example.cloudflareaccess.com", aud: "" },
	agents: {},
	// Repos the Ops agent follows (the ops plugin): name → a bare repo or a working copy's .git on the server.
	devRepos: {
		pocketcrew: { path: "/srv/agents-git/pocketcrew.git", about: "pocketcrew: this agent fleet" },
	},
	gitRoot: "/srv/agents-git",
	backupDir: "",
	// A Cloudflare Secrets Store id, if you keep secrets there; empty: Worker secrets.
	secretsStore: "",
} satisfies Partial<Config>;
