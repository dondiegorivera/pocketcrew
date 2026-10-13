// What the dashboard shows, read from disk only: the deployed code (fleet, roles, skills, board), the two archives the
// sync fills (~/<name>-research, ~/<name>-private), and the deploy pipeline's state. It never calls Cloudflare and
// never writes, so it is as fresh as the last sync (15 minutes) and the last deploy.
import { CONFIG } from "../config.ts";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { allowance, type Allowance, type Credit } from "../budget.ts";
import { type Board, parseBoard } from "./board.ts";

export type Paths = { code: string; research: string; private: string; deploys: string };

export const defaultPaths = (): Paths => ({
	code: resolve(fileURLToPath(new URL("../..", import.meta.url))),
	research: join(homedir(), `${CONFIG.name}-research`),
	private: join(homedir(), `${CONFIG.name}-private`),
	deploys: join(homedir(), ".cache", `${CONFIG.name}-deploy`),
});

export type ArchiveName = "research" | "private";
export const ARCHIVES: ArchiveName[] = ["research", "private"];

export type ReportInfo = { archive: ArchiveName; file: string; id: number; agent: string; project: string; title: string; date: string; cost: number };
export type PageFile = { archive: ArchiveName; path: string; topic: string; title: string; modified: number };

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : undefined);

/** `file` inside `root`, or undefined: nothing outside an archive is ever served. */
export function inside(root: string, file: string): string | undefined {
	const full = resolve(root, file);
	return full.startsWith(resolve(root) + sep) ? full : undefined;
}

export function board(p: Paths): Board | undefined {
	const text = read(join(p.code, "docs", "board.md"));
	return text === undefined ? undefined : parseBoard(text);
}

const unquote = (v: string) => (/^".*"$/.test(v) ? (JSON.parse(v) as string) : v);

/** Every report in an archive, newest first, from the front matter the sync writes. */
export function reports(p: Paths, archive: ArchiveName): ReportInfo[] {
	const dir = join(p[archive], "reports");
	if (!existsSync(dir)) return [];
	const out: ReportInfo[] = [];
	for (const month of readdirSync(dir).sort()) {
		if (!statSync(join(dir, month)).isDirectory()) continue;
		for (const f of readdirSync(join(dir, month)).filter((x) => x.endsWith(".md"))) {
			const head = readFileSync(join(dir, month, f), "utf8").split("\n---\n")[0]!;
			const field = (k: string) => unquote(new RegExp(`^${k}: (.*)$`, "m").exec(head)?.[1]?.trim() ?? "");
			out.push({ archive, file: `${month}/${f}`, id: Number(field("id")), agent: field("agent"), project: field("project"), title: field("title"), date: field("date").slice(0, 10), cost: Number(field("cost_usd")) || 0 });
		}
	}
	return out.sort((a, b) => b.id - a.id);
}

export function report(p: Paths, archive: ArchiveName, file: string): string | undefined {
	if (!/^\d{4}-\d{2}\/[\w.-]+\.md$/.test(file)) return undefined;
	const full = inside(join(p[archive], "reports"), file);
	return full ? read(full) : undefined;
}

/** Every published page in an archive, newest change first. */
export function pages(p: Paths, archive: ArchiveName): PageFile[] {
	const root = join(p[archive], "pages");
	if (!existsSync(root)) return [];
	const out: PageFile[] = [];
	const walk = (dir: string) => {
		for (const f of readdirSync(dir)) {
			const full = join(dir, f);
			if (statSync(full).isDirectory()) walk(full);
			else if (f.endsWith(".html")) {
				const path = relative(root, full).split(sep).join("/");
				const title = /<title[^>]*>([^<]*)<\/title>/i.exec(readFileSync(full, "utf8").slice(0, 4000))?.[1]?.trim() || f;
				out.push({ archive, path, topic: path.split("/")[0]!, title, modified: statSync(full).mtimeMs });
			}
		}
	};
	walk(root);
	return out.sort((a, b) => b.modified - a.modified);
}

export function page(p: Paths, archive: ArchiveName, path: string): string | undefined {
	if (!/^[\w.-]+(\/[\w.-]+)*\.html$/.test(path)) return undefined;
	const full = inside(join(p[archive], "pages"), path);
	return full ? read(full) : undefined;
}

export type State = {
	credit?: Credit;
	models?: Record<string, string>;
	leadNotes?: string;
	projects?: { name: string; goal: string; context: string; updated: number }[];
	routines?: { id: number; name: string; agent: string; cron: string; task: string; project: string | null; last_run: number | null; last_job: number | null }[];
	wishes?: { id: number; agent: string; task: string; model: string | null; created: number; job: number | null }[];
	jobs?: { id: number; agent: string; model: string | null; project: string | null; task: string; status: string; created: number; finished: number | null; cost: number | null; summary: string | null }[];
	spendByDay?: { day: string; agent: string; model: string; usd: number }[];
	syncedAt?: number;
};

/** The Director's state as the sync last wrote it into the private archive. */
export function state(p: Paths): State {
	const dir = join(p.private, "state");
	const json = (name: string) => {
		const t = read(join(dir, `${name}.json`));
		try {
			return t === undefined ? undefined : JSON.parse(t);
		} catch {
			return undefined;
		}
	};
	const syncedAt = existsSync(join(dir, "jobs.json")) ? statSync(join(dir, "jobs.json")).mtimeMs : undefined;
	return {
		credit: json("credit"),
		models: json("models"),
		leadNotes: read(join(dir, "lead-notes.md")),
		projects: json("projects"),
		routines: json("routines"),
		wishes: json("wishes"),
		jobs: json("jobs"),
		spendByDay: json("spend-by-day"),
		syncedAt,
	};
}

/** The budget as /budget computes it, from the day totals in the state (so as of the last sync). */
export function budget(s: State, now = Date.now()): Allowance | undefined {
	if (!s.credit) return undefined;
	const asOfDay = s.credit.asOf.slice(0, 10);
	const today = new Date(now).toISOString().slice(0, 10);
	const days = s.spendByDay ?? [];
	const sum = (rows: typeof days) => rows.reduce((n, r) => n + r.usd, 0);
	// Day totals cannot split the reading's own day; spend after the reading on that day is counted in full.
	return allowance(s.credit, now, sum(days.filter((r) => r.day >= asOfDay)), sum(days.filter((r) => r.day === today)));
}

export type Deploy = { at: string; sha: string; what: string };

export function deploys(p: Paths, limit = 30): { live?: string; log: Deploy[]; commits: { sha: string; date: string; subject: string }[] } {
	const live = read(join(p.deploys, "deployed"))?.trim();
	const log = (read(join(p.deploys, "deploy.log")) ?? "")
		.split("\n")
		.map((l) => /^(\S+Z) ([0-9a-f]{7}) (.+)$/.exec(l))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => ({ at: m[1]!, sha: m[2]!, what: m[3]! }))
		.reverse()
		.slice(0, limit);
	let commits: { sha: string; date: string; subject: string }[] = [];
	try {
		commits = execFileSync("git", ["-C", p.code, "log", "-25", "--format=%h%x1f%cI%x1f%s"], { encoding: "utf8" })
			.split("\n")
			.filter(Boolean)
			.map((l) => {
				const [sha, date, subject] = l.split("\x1f");
				return { sha: sha!, date: date!.slice(0, 16).replace("T", " "), subject: subject! };
			});
	} catch {
		// not a git checkout: no history to show
	}
	return { live, log, commits };
}
