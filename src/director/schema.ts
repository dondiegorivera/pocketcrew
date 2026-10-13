// The Director's own tables, created and brought up to date in one place: by the Durable Object at start, and by
// the tests on an in-memory database. Stores with tables of their own (skills, wishes, sales, sent) create them.
import { ZONE, type Routine, utcCronToLocal } from "../routines.ts";
import type { Sql } from "../sql.ts";

export type JobRow = {
	id: number;
	key: string;
	agent: string;
	worker: string | null;
	task: string;
	project: string | null;
	skills: string | null;
	model: string | null;
	inputs: string | null;
	status: string;
	created: number;
	started: number | null;
	finished: number | null;
	cost: number | null;
	summary: string | null;
	title: string | null;
	rating: string | null;
	message_id: string | null;
};

/** Columns added after a table first shipped: added in place, so a live Director keeps its data. */
const ADDED: [table: string, column: string][] = [
	["jobs", "skills"],
	["routines", "skills"],
	["jobs", "model"],
	["routines", "model"],
	["routines", "zone"],
	["jobs", "inputs"],
	["jobs", "title"],
	["jobs", "rating"],
	["jobs", "message_id"],
];

export function migrate(sql: Sql, now = Date.now()) {
	sql("CREATE TABLE IF NOT EXISTS topics (agent TEXT PRIMARY KEY, thread INTEGER UNIQUE)");
	sql("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)");
	sql("CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, agent TEXT, worker TEXT, task TEXT, project TEXT, status TEXT, created INTEGER, started INTEGER, finished INTEGER, cost REAL, summary TEXT)");
	sql("CREATE TABLE IF NOT EXISTS projects (name TEXT PRIMARY KEY, goal TEXT, context TEXT, updated INTEGER)");
	sql("CREATE TABLE IF NOT EXISTS spend (at INTEGER, agent TEXT, model TEXT, usd REAL)");
	sql("CREATE INDEX IF NOT EXISTS spend_at ON spend (at)");
	sql("CREATE TABLE IF NOT EXISTS routines (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, agent TEXT, cron TEXT, task TEXT, project TEXT, created INTEGER, last_run INTEGER, last_job INTEGER)");
	for (const [table, column] of ADDED)
		if (!sql<{ name: string }>("SELECT name FROM pragma_table_info(?) WHERE name = ?", table, column).length) sql(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
	// Routines saved before crons were read in local time: the same wall-clock time today, in local time.
	for (const r of sql<Routine>("SELECT * FROM routines WHERE zone IS NULL")) sql("UPDATE routines SET cron = ?, zone = ? WHERE id = ?", utcCronToLocal(r.cron, now), ZONE, r.id);
}
