// The wishlist: one-off jobs the operator wants done some time, run on credit that quiet days left unspent. The
// Director starts one at a time, oldest first, when budget.ts says credit is spare (spareForWishes); otherwise they
// wait. A wish may name a model for that one job (an Opus clean-up, say); otherwise it runs on its agent's model.
import type { Sql } from "./sql.ts";

export type Wish = { id: number; agent: string; task: string; project: string | null; model: string | null; created: number; job: number | null };

const MODEL_WORDS = ["haiku", "sonnet", "opus"];

/** Everyday words for an agent, so "/wish email …" reaches Mail. */
const AGENT_WORDS: Record<string, string> = { email: "mail", gmail: "mail", inbox: "mail", cal: "calendar", tax: "clerk", docs: "clerk", drive: "clerk", domains: "scout", web: "research", note: "notes" };

/** `/wish [agent] [haiku|sonnet|opus] <task>`, agent and model in either order: without an agent the wish goes to research. */
export function parseWish(arg: string, specialists: readonly string[]): { agent: string; model?: string; task: string } | undefined {
	let rest = arg.trim();
	let agent: string | undefined;
	let model: string | undefined;
	for (let i = 0; i < 2; i++) {
		const m = /^(\S+)\s*([\s\S]*)$/.exec(rest);
		const w = m?.[1]?.toLowerCase().replace(/[:,]$/, "") ?? "";
		const named = specialists.includes(w) ? w : AGENT_WORDS[w] && specialists.includes(AGENT_WORDS[w]!) ? AGENT_WORDS[w] : undefined;
		if (!agent && named) agent = named;
		else if (!model && MODEL_WORDS.includes(w)) model = w;
		else break;
		rest = m?.[2] ?? "";
	}
	return rest.trim() ? { agent: agent ?? "research", model, task: rest.trim() } : undefined;
}

export const WISH_INSTRUCTIONS =
	"This job comes from the operator's wishlist: work they want done when credit is spare, started without a fresh request. " +
	"Do it as thoroughly as the brief asks; nobody is waiting on it right now.";

export const wishBrief = (w: Pick<Wish, "id" | "task">) => `Wish #${w.id}.\n${WISH_INSTRUCTIONS}\n\n${w.task}`;

/** The job key of a wish's run, so a wish never starts twice. */
export const wishJobKey = (id: number) => `wish:${id}`;

export class WishStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
		sql("CREATE TABLE IF NOT EXISTS wishes (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, agent TEXT, task TEXT, project TEXT, model TEXT, created INTEGER, job INTEGER)");
		if (!sql("SELECT name FROM pragma_table_info('wishes') WHERE name = 'model'").length) sql("ALTER TABLE wishes ADD COLUMN model TEXT");
	}

	/** Adds a wish and returns its number; the same `key` again (a replayed tool call) returns the first one's. */
	add(key: string, agent: string, task: string, project: string | undefined, model?: string, now = Date.now()): number {
		this.sql("INSERT OR IGNORE INTO wishes (key, agent, task, project, model, created) VALUES (?, ?, ?, ?, ?, ?)", key, agent, task, project ?? null, model ?? null, now);
		return this.sql<{ id: number }>("SELECT id FROM wishes WHERE key = ?", key)[0]!.id;
	}

	waiting(): number {
		return this.sql<{ n: number }>("SELECT COUNT(*) AS n FROM wishes WHERE job IS NULL")[0]!.n;
	}

	/** The oldest wish not started yet. */
	next(): Wish | undefined {
		return this.sql<Wish>("SELECT * FROM wishes WHERE job IS NULL ORDER BY id LIMIT 1")[0];
	}

	started(id: number, job: number) {
		this.sql("UPDATE wishes SET job = ? WHERE id = ?", job, id);
	}

	/** Removes a wish that has not started. */
	drop(id: number): string {
		const w = this.sql<Wish>("SELECT * FROM wishes WHERE id = ?", id)[0];
		if (!w) return `No wish #${id}.`;
		if (w.job !== null) return `Wish #${id} already ran as job #${w.job}; cancel the job instead.`;
		this.sql("DELETE FROM wishes WHERE id = ?", id);
		return `Wish #${id} dropped.`;
	}

	all(): Wish[] {
		return this.sql<Wish>("SELECT * FROM wishes ORDER BY id");
	}

	/** Waiting wishes, then the five most recently started. */
	text(): string {
		const waiting = this.sql<Wish>("SELECT * FROM wishes WHERE job IS NULL ORDER BY id");
		const done = this.sql<Wish>("SELECT * FROM wishes WHERE job IS NOT NULL ORDER BY id DESC LIMIT 5");
		const line = (w: Wish) => `#${w.id} ${w.agent}${w.model ? ` · ${w.model.replace("claude-", "")}` : ""}${w.project ? ` [${w.project}]` : ""}${w.job !== null ? ` · job #${w.job}` : ""}: ${w.task.split("\n")[0]!.slice(0, 120)}`;
		if (!waiting.length && !done.length) return "The wishlist is empty. /wish [agent] [haiku|sonnet|opus] <task> adds one; it runs when quiet days leave credit spare.";
		return [
			waiting.length ? `Waiting (oldest runs first):\n${waiting.map(line).join("\n")}` : "Nothing waiting.",
			...(done.length ? [`Started:\n${done.map(line).join("\n")}`] : []),
		].join("\n\n");
	}
}
