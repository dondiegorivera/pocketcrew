// The private archive: finished reports of agents that hold the operator's private data (Mail, Calendar, Clerk,
// Outreach, Ops), which never go into the research library. No agent searches it: there is no tool for it. A report
// leaves only through the export that scripts/sync.mjs copies into the server-only <name>-private repo, and as the
// input of a job the Lead chains to a private agent with no way out (fleet.ts inputProblem). Hosted in the Library object.
import type { NewReport, Report } from "./library.ts";
import type { Sql } from "./sql.ts";

export class VaultStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
		sql("CREATE TABLE IF NOT EXISTS private_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, job INTEGER UNIQUE, agent TEXT, project TEXT, title TEXT, brief TEXT, summary TEXT, body TEXT, cost REAL, created INTEGER)");
	}

	/** Keeps a job's report once; a repeated delivery of the same job returns the first id. */
	add(r: NewReport, now = Date.now()): number {
		this.sql(
			"INSERT OR IGNORE INTO private_reports (job, agent, project, title, brief, summary, body, cost, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			r.job, r.agent, r.project, r.title, r.brief, r.summary, r.body, r.cost, now,
		);
		return this.sql<{ id: number }>("SELECT id FROM private_reports WHERE job = ?", r.job)[0]!.id;
	}

	byJob(job: number): Report | undefined {
		return this.sql<Report>("SELECT * FROM private_reports WHERE job = ?", job)[0];
	}

	/** The export: reports after `id`, oldest first. */
	after(id: number, limit = 50): Report[] {
		return this.sql<Report>("SELECT * FROM private_reports WHERE id > ? ORDER BY id LIMIT ?", id, limit);
	}
}
