// The git feed: what changed in the operator's repos, for the Ops agent to report on. The server's sync reads each
// repo's history (read-only) and uploads compact commits; secrets are scrubbed before anything leaves the server.
// Pure: shared by the Worker (store and tools) and scripts/sync.mjs (repo list, parsing, scrubbing).
import { CONFIG } from "./config.ts";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import type { Sql } from "./sql.ts";

/** The repos the feed follows: a bare repo, or a working copy's .git when there is no bare repo. */
export const DEV_REPOS = CONFIG.devRepos; // pocketcrew.config.ts

export type DevRepo = string;
export const isDevRepo = (name: string): name is DevRepo => Object.hasOwn(DEV_REPOS, name);

export type FileChange = { path: string; added: number; deleted: number };
export type Commit = { sha: string; date: number; author: string; subject: string; body: string; ref: string; files: FileChange[]; patch: string };
export type Head = { ref: string; sha: string; date: number; subject: string };

export const MAX_BODY_CHARS = 2_000;
export const MAX_PATCH_CHARS = 12_000;
export const KEEP_DAYS = 120;

// ---- Scrubbing (server side, before upload) ----

const SECRET_FILE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)(\.pub)?|.*secrets?\.(json|ya?ml|toml)|credentials(\.json)?)$/i;
const SECRET_TEXT = [
	/sk-ant-[A-Za-z0-9_-]{10,}/g,
	/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
	/github_pat_[A-Za-z0-9_]{20,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
	/\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/g, // Telegram bot tokens
	/GOCSPX-[A-Za-z0-9_-]{10,}/g,
	/AIza[0-9A-Za-z_-]{30,}/g,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
	/((?:api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["']?)([^\s"']{12,})/gi,
];

export const isSecretFile = (path: string) => SECRET_FILE.test(path);

export function scrub(text: string): string {
	let out = text;
	for (const re of SECRET_TEXT) out = out.replace(re, (m, prefix?: string) => (typeof prefix === "string" && m.startsWith(prefix) && prefix.length < m.length ? `${prefix}[redacted]` : "[redacted]"));
	return out;
}

/** A commit's patch with secret-looking files and values removed, cut to MAX_PATCH_CHARS. */
export function cleanPatch(patch: string): string {
	const parts = patch.split(/(?=^diff --git )/m).map((part) => {
		const path = /^diff --git a\/(\S+)/.exec(part)?.[1];
		return path && isSecretFile(path) ? `diff --git a/${path} b/${path}\n[content not uploaded: secret-like file]\n` : scrub(part);
	});
	const joined = parts.join("");
	return joined.length > MAX_PATCH_CHARS ? `${joined.slice(0, MAX_PATCH_CHARS)}\n[patch cut at ${MAX_PATCH_CHARS} characters]` : joined;
}

// ---- The store (Worker side) ----

const day = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

export class GitStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
		sql("CREATE TABLE IF NOT EXISTS git_commits (repo TEXT, sha TEXT, date INTEGER, author TEXT, subject TEXT, body TEXT, ref TEXT, files TEXT, patch TEXT, PRIMARY KEY (repo, sha))");
		sql("CREATE INDEX IF NOT EXISTS git_commits_date ON git_commits (repo, date)");
		sql("CREATE TABLE IF NOT EXISTS git_heads (repo TEXT, ref TEXT, sha TEXT, date INTEGER, subject TEXT, PRIMARY KEY (repo, ref))");
	}

	/** The sync's upload: new commits are added (repeats ignored), heads replaced, old commits pruned. */
	upload(repo: string, commits: readonly Commit[], heads: readonly Head[] | undefined, now = Date.now()) {
		for (const c of commits)
			this.sql("INSERT OR IGNORE INTO git_commits VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", repo, c.sha, c.date, c.author, c.subject, c.body.slice(0, MAX_BODY_CHARS), c.ref, JSON.stringify(c.files), c.patch);
		if (heads) {
			this.sql("DELETE FROM git_heads WHERE repo = ?", repo);
			for (const h of heads) this.sql("INSERT INTO git_heads VALUES (?, ?, ?, ?, ?)", repo, h.ref, h.sha, h.date, h.subject);
		}
		this.sql("DELETE FROM git_commits WHERE repo = ? AND date < ?", repo, now - KEEP_DAYS * 86_400_000);
	}

	repos(now = Date.now()): string {
		const week = now - 7 * 86_400_000;
		return (Object.keys(DEV_REPOS) as DevRepo[])
			.map((r) => {
				const s = this.sql<{ n: number; last: number | null }>("SELECT COUNT(*) AS n, MAX(date) AS last FROM git_commits WHERE repo = ? AND date >= ?", r, week)[0]!;
				const last = this.sql<{ last: number | null }>("SELECT MAX(date) AS last FROM git_commits WHERE repo = ?", r)[0]!.last;
				const branches = this.sql<{ n: number }>("SELECT COUNT(*) AS n FROM git_heads WHERE repo = ? AND date >= ?", r, week)[0]!.n;
				return `${r}: ${s.n} commits in 7 days, ${branches} branches active, last ${last ? day(last) : "none"} · ${DEV_REPOS[r]!.about}`;
			})
			.join("\n");
	}

	log(repo: string, o: { since?: number; until?: number; branch?: string; author?: string; path?: string; text?: string; max?: number }): string {
		const rows = this.sql<Omit<Commit, "files" | "patch"> & { files: string }>(
			"SELECT sha, date, author, subject, body, ref, files FROM git_commits WHERE repo = ? AND date >= ? AND date <= ? ORDER BY date DESC",
			repo, o.since ?? 0, o.until ?? Number.MAX_SAFE_INTEGER,
		);
		const like = (s: string, q?: string) => !q || s.toLowerCase().includes(q.toLowerCase());
		const hits = rows.filter((c) => like(c.ref, o.branch) && like(c.author, o.author) && like(`${c.subject}\n${c.body}`, o.text) && (!o.path || c.files.toLowerCase().includes(o.path.toLowerCase())));
		const shown = hits.slice(0, Math.min(o.max ?? 60, 200));
		if (!shown.length) return `No commits in ${repo} match.`;
		const lines = shown.map((c) => {
			const files = JSON.parse(c.files) as FileChange[];
			const added = files.reduce((n, f) => n + f.added, 0);
			const deleted = files.reduce((n, f) => n + f.deleted, 0);
			return `${c.sha.slice(0, 9)} · ${day(c.date)} · ${c.author} · ${c.ref || "?"} · ${c.subject} (${files.length} files, +${added} −${deleted})`;
		});
		return `${lines.join("\n")}${hits.length > shown.length ? `\n[${hits.length - shown.length} more; narrow the range or filters]` : ""}`;
	}

	show(repo: string, sha: string): string {
		const c = this.sql<Commit & { files: string }>("SELECT * FROM git_commits WHERE repo = ? AND sha LIKE ? ORDER BY date DESC LIMIT 1", repo, `${sha.replace(/[^0-9a-f]/gi, "")}%`)[0];
		if (!c) return `No commit ${sha} in ${repo} (the feed keeps ${KEEP_DAYS} days).`;
		const files = (JSON.parse(c.files) as FileChange[]).map((f) => `  ${f.path} +${f.added} −${f.deleted}`).join("\n");
		return `${c.sha} · ${day(c.date)} · ${c.author} · ${c.ref}\n${c.subject}\n\n${c.body}\n\nFiles:\n${files}\n\n${c.patch}`;
	}

	branches(repo: string, days = 14, now = Date.now()): string {
		const rows = this.sql<Head>("SELECT ref, sha, date, subject FROM git_heads WHERE repo = ? AND date >= ? ORDER BY date DESC", repo, now - days * 86_400_000);
		return rows.length ? rows.map((h) => `${h.ref} · ${day(h.date)} · ${h.sha.slice(0, 9)} · ${h.subject}`).join("\n") : `No branch of ${repo} moved in ${days} days.`;
	}
}

/** What the git tools call, as RPC. */
export type GitApi = {
	gitRepos(): Promise<string>;
	gitLog(repo: string, o: Parameters<GitStore["log"]>[1]): Promise<string>;
	gitShow(repo: string, sha: string): Promise<string>;
	gitBranches(repo: string, days?: number): Promise<string>;
};

const reply = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const at = (date: string | undefined, end = false) => (date ? Date.parse(/T/.test(date) ? date : `${date}T${end ? "23:59:59" : "00:00:00"}Z`) : undefined);

export const gitKit = (git: () => Promise<GitApi>): Extension => {
	const repo = Type.Union((Object.keys(DEV_REPOS) as DevRepo[]).map((r) => Type.Literal(r)), { description: (Object.keys(DEV_REPOS) as DevRepo[]).map((r) => `${r}: ${DEV_REPOS[r]!.about}`).join(" | ") });
	return defineExtension({
		name: "git",
		tools: [
			defineTool({
				name: "git_repos",
				description: "The repos you follow, with their activity in the last 7 days.",
				parameters: Type.Object({}),
				replay: "safe",
				execute: async () => reply(await (await git()).gitRepos()),
			}),
			defineTool({
				name: "git_log",
				description: "Commits of a repo, newest first, with author, branch, files and size of change. Filter by dates (YYYY-MM-DD, UTC), branch, author, a path, or words in the message.",
				parameters: Type.Object({
					repo,
					since: Type.Optional(Type.String()),
					until: Type.Optional(Type.String()),
					branch: Type.Optional(Type.String()),
					author: Type.Optional(Type.String()),
					path: Type.Optional(Type.String()),
					text: Type.Optional(Type.String()),
					max: Type.Optional(Type.Integer({ description: "Default 60, at most 200" })),
				}),
				replay: "safe",
				execute: async ({ repo: r, since, until, ...rest }) => reply(await (await git()).gitLog(r, { since: at(since), until: at(until, true), ...rest })),
			}),
			defineTool({
				name: "git_show",
				description: "One commit in full: message, files and its diff (cut when long; secret-like content is never uploaded).",
				parameters: Type.Object({ repo, sha: Type.String({ description: "Commit id, at least 7 characters" }) }),
				replay: "safe",
				execute: async ({ repo: r, sha }) => reply(await (await git()).gitShow(r, sha)),
			}),
			defineTool({
				name: "git_branches",
				description: "Branches that moved recently, newest first, with their last commit.",
				parameters: Type.Object({ repo, days: Type.Optional(Type.Integer({ description: "Default 14" })) }),
				replay: "safe",
				execute: async ({ repo: r, days }) => reply(await (await git()).gitBranches(r, days)),
			}),
		],
	});
};
