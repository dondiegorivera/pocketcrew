// The owner's settings (pocketcrew.config.ts at the repo root), with defaults for what it leaves out. Read by the Worker,
// the bundlers and the server's scripts (plain node: no imports here but the config itself), so one file says where
// this instance lives, whose day it follows and what it watches.
import owner from "../pocketcrew.config.ts";

export type AgentOverride = { model?: string; effort?: "low" | "medium" | "high"; share?: number; parallelJobs?: number };

export type Config = {
	/**
	 * This instance's name: the Worker, the secrets prefix, the Gmail label, the server's folders and services are
	 * named after it (lowercase letters, digits and hyphens).
	 */
	name: string;
	/** The reports site's Worker. */
	reportsWorker: string;
	/** Plugins compiled in, by folder name under plugins/. */
	plugins: string[];
	/** The operator's IANA time zone: routines, digests, quiet hours and the calendar follow it. */
	timeZone: string;
	/** Hours (local) when messages arrive without a sound: from, until. */
	quietHours: [from: number, until: number];
	/** The morning briefing's hour, and the hour after which it stops waiting for routines still running. */
	briefingHour: number;
	briefingLatestHour: number;
	/** The evening inbox line's hour (with the google plugin). */
	inboxHour: number;
	/** The nightly cost line's hour. */
	nightlyHour: number;
	/** The credit as the Anthropic Console showed it; `/credit` overrides it at runtime. */
	credit: { usd: number; asOf: string; expires: string };
	/** The Worker's public address (the Telegram webhook, the Google sign-in) and the reports site's. */
	url: string;
	reportsUrl: string;
	/** The Cloudflare Access application in front of the reports site: its team domain and audience tag (identifiers, not secrets). */
	reportsAccess: { teamDomain: string; aud: string };
	/** Per-agent changes to the fleet's defaults (fleet.ts and the plugins), by agent name. */
	agents: Record<string, AgentOverride>;
	/** Repos the git feed follows (ops plugin): name → a bare repo, or a working copy's .git, and one line about it. */
	devRepos: Record<string, { path: string; about: string }>;
	/** Where the server keeps bare repos, and where the nightly backup copies them. */
	gitRoot: string;
	backupDir: string;
	/** The account's Cloudflare Secrets Store id; empty keeps every secret as a Worker secret. */
	secretsStore: string;
};

const DEFAULTS: Config = {
	name: "pocketcrew",
	reportsWorker: "pocketcrew-reports",
	plugins: [],
	timeZone: "UTC",
	quietHours: [22, 7],
	briefingHour: 10,
	briefingLatestHour: 11,
	inboxHour: 18,
	nightlyHour: 22,
	credit: { usd: 0, asOf: "1970-01-01T00:00:00Z", expires: "1970-01-01T00:00:00Z" },
	url: "",
	reportsUrl: "",
	reportsAccess: { teamDomain: "", aud: "" },
	agents: {},
	devRepos: {},
	gitRoot: "/srv/agents-git",
	backupDir: "",
	secretsStore: "",
};

/**
 * Tests run on fixed times and a fixed zone, whatever the owner set: package.json's test scripts set POCKETCREW_TEST.
 * Plugins and the rest still come from the owner's file, so their tests run with them.
 */
const TEST: Partial<Config> = { name: "pocketcrew", reportsWorker: "pocketcrew-reports", timeZone: "Europe/Berlin", quietHours: [22, 7], briefingHour: 10, briefingLatestHour: 11, inboxHour: 18, nightlyHour: 22, agents: {}, devRepos: { mesh: { path: "/nonexistent/mesh.git", about: "a test repo" } } };
const testing = typeof process !== "undefined" && process.env?.POCKETCREW_TEST === "1";

export const CONFIG: Config = { ...DEFAULTS, ...(owner as Partial<Config>), ...(testing ? TEST : {}) };

/** The zone's city, for text: Europe/Lisbon → Lisbon. */
export const ZONE_NAME = CONFIG.timeZone.split("/").pop()!.replace(/_/g, " ");
