// The research library: every finished job report, searchable, so later jobs build on earlier ones instead of
// redoing them. The store is plain SQLite with full-text search; library-object.ts hosts it in a Durable Object, and
// scripts/sync.mjs copies new reports into the <name>-research git repo (one way: the repo is the archive).
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import type { Sql } from "./sql.ts";

export type Report = {
	id: number;
	job: number;
	agent: string;
	project: string | null;
	title: string;
	brief: string;
	summary: string;
	body: string;
	cost: number;
	created: number;
};
export type NewReport = Omit<Report, "id" | "created">;

/** What agents and the Director call on the library, as RPC. */
export type LibraryApi = {
	add(report: NewReport): Promise<number>;
	search(query: string, limit?: number): Promise<string>;
	read(id: number, from?: number): Promise<string>;
};

const READ_CHARS = 12_000;
const SEARCH_LIMIT = 8;

/** Words of a free-text query as FTS5 prefix terms; FTS syntax in the query is never passed through. */
export const ftsTerms = (query: string): string[] => (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12).map((w) => `"${w}"*`);

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const oneLine = (s: string, n: number) => {
	const flat = s.replace(/\s+/g, " ").trim();
	return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};
export const reportLine = (r: Pick<Report, "id" | "agent" | "project" | "title" | "summary" | "created">) =>
	`#${r.id} · ${day(r.created)} · ${r.agent}${r.project ? ` [${r.project}]` : ""} · ${r.title}\n   ${oneLine(r.summary, 220)}`;

export class LibraryStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
		sql(
			"CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, job INTEGER UNIQUE, agent TEXT, project TEXT, title TEXT, brief TEXT, summary TEXT, body TEXT, cost REAL, created INTEGER)",
		);
		sql("CREATE VIRTUAL TABLE IF NOT EXISTS reports_fts USING fts5(title, project, summary, body, brief)");
	}

	byJob(job: number): Report | undefined {
		return this.sql<Report>("SELECT * FROM reports WHERE job = ?", job)[0];
	}

	/** Files a job's report once; a repeated delivery of the same job returns the first id. */
	add(r: NewReport, now = Date.now()): number {
		const existing = this.sql<{ id: number }>("SELECT id FROM reports WHERE job = ?", r.job)[0];
		if (existing) return existing.id;
		this.sql(
			"INSERT INTO reports (job, agent, project, title, brief, summary, body, cost, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			r.job, r.agent, r.project, r.title, r.brief, r.summary, r.body, r.cost, now,
		);
		const id = this.sql<{ id: number }>("SELECT id FROM reports WHERE job = ?", r.job)[0]!.id;
		this.sql("INSERT INTO reports_fts (rowid, title, project, summary, body, brief) VALUES (?, ?, ?, ?, ?, ?)", id, r.title, r.project ?? "", r.summary, r.body, r.brief);
		return id;
	}

	/** Best matches first: every word if possible, otherwise any. An empty query lists the newest. */
	search(query: string, limit = SEARCH_LIMIT): string {
		const terms = ftsTerms(query);
		const cols = "r.id, r.agent, r.project, r.title, r.summary, r.created";
		let rows: Report[] = [];
		if (!terms.length) rows = this.sql<Report>(`SELECT ${cols} FROM reports r ORDER BY r.id DESC LIMIT ?`, limit);
		for (const match of terms.length ? [terms.join(" "), terms.join(" OR ")] : []) {
			rows = this.sql<Report>(`SELECT ${cols} FROM reports_fts f JOIN reports r ON r.id = f.rowid WHERE reports_fts MATCH ? ORDER BY bm25(reports_fts, 5, 2, 3, 1, 2) LIMIT ?`, match, limit);
			if (rows.length) break;
		}
		if (!rows.length) return terms.length ? `No reports match "${query}".` : "The library is empty so far.";
		return rows.map(reportLine).join("\n");
	}

	/** One report, in pages of READ_CHARS. */
	read(id: number, from = 0): string {
		const r = this.sql<Report>("SELECT * FROM reports WHERE id = ?", id)[0];
		if (!r) return `No report #${id}.`;
		const page = r.body.slice(from, from + READ_CHARS);
		const more = from + READ_CHARS < r.body.length ? `\n\n[continues: library_read id=${id} from=${from + READ_CHARS}]` : "";
		const head = from > 0 ? `Report #${id}, from character ${from}:` : `Report #${id} · ${day(r.created)} · ${r.agent}${r.project ? ` · project ${r.project}` : ""} · job #${r.job}\nTitle: ${r.title}\nBrief: ${oneLine(r.brief, 600)}\n`;
		return `${head}\n${page}${more}`;
	}

	/** Reports after `id`, oldest first: the export the git sync pulls. */
	after(id: number, limit = 50): Report[] {
		return this.sql<Report>("SELECT * FROM reports WHERE id > ? ORDER BY id LIMIT ?", id, limit);
	}
}

const reply = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export const libraryKit = (library: () => Promise<LibraryApi>): Extension =>
	defineExtension({
		name: "library",
		tools: [
			defineTool({
				name: "library_search",
				description:
					"Search the fleet's earlier research reports by keywords. Check it before researching a topic that may have come up " +
					"before, then build on what is there: read the report, verify what may be outdated, and cite it as report #n.",
				parameters: Type.Object({ query: Type.String({ description: "Keywords: names, topics, project" }) }),
				replay: "safe",
				execute: async ({ query }) => reply(await (await library()).search(query)),
			}),
			defineTool({
				name: "library_read",
				description: "Read one earlier report in full, by its number from library_search.",
				parameters: Type.Object({
					id: Type.Integer({ description: "Report number" }),
					from: Type.Optional(Type.Integer({ description: "Character offset, to continue a long report" })),
				}),
				replay: "safe",
				execute: async ({ id, from }) => reply(await (await library()).read(id, from ?? 0)),
			}),
		],
	});
