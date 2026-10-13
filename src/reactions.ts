// Reactions as a small vocabulary on any fleet message in Telegram: what an emoji asks for, and how the operator's
// likes and dislikes are written for an agent. The Director keeps which message was whose (`sent`) and acts.
//   ❤️ 👍 🔥 …  more like this        👎 …  less like this        ✍  save to the notes
//   👀  bring it back tomorrow         🤔  say it plainer          🙈  stop showing me this kind
import type { Sql } from "./sql.ts";

export type ReactionAction = "up" | "down" | "note" | "later" | "explain" | "hide";

const UP = ["👍", "❤", "❤️", "🔥", "🥰", "👏", "🎉", "🤩", "🙏", "👌", "💯", "⚡", "🏆", "😍", "❤‍🔥", "🤝", "🫡"];
const DOWN = ["👎", "💩", "🤮", "😴", "🥱", "😐", "💔"];

/** What the newly added reactions ask for, in the order they should run; unknown emoji are ignored. */
export function reactionActions(added: readonly string[]): ReactionAction[] {
	const out = new Set<ReactionAction>();
	for (const e of added) {
		if (e === "✍" || e === "✍️") out.add("note");
		else if (e === "👀") out.add("later");
		else if (e === "🤔" || e === "🤨") out.add("explain");
		else if (e === "🙈") out.add("hide");
		else if (UP.includes(e)) out.add("up");
		else if (DOWN.includes(e)) out.add("down");
	}
	return [...out];
}

/** A message the fleet sent, as far as reactions need it. */
export type Sent = { message_id: number; agent: string | null; kind: string; job: number | null; gmail: string | null; text: string; at: number };

export class SentStore {
	private readonly sql: Sql;
	constructor(sql: Sql) {
		this.sql = sql;
		sql("CREATE TABLE IF NOT EXISTS sent (message_id INTEGER PRIMARY KEY, agent TEXT, kind TEXT, job INTEGER, gmail TEXT, text TEXT, at INTEGER)");
		sql("CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT, rating TEXT, text TEXT, at INTEGER)");
	}
	note(messageId: number, s: { agent?: string; kind: string; job?: number; gmail?: string; text: string }, now = Date.now()) {
		this.sql("INSERT OR REPLACE INTO sent VALUES (?, ?, ?, ?, ?, ?, ?)", messageId, s.agent ?? null, s.kind, s.job ?? null, s.gmail ?? null, s.text.slice(0, 4000), now);
		this.sql("DELETE FROM sent WHERE at < ?", now - 60 * 86_400_000);
	}
	get(messageId: number): Sent | undefined {
		return this.sql<Sent>("SELECT * FROM sent WHERE message_id = ?", messageId)[0];
	}
	addFeedback(agent: string, rating: "up" | "down" | "hide", text: string, now = Date.now()) {
		this.sql("INSERT INTO feedback (agent, rating, text, at) VALUES (?, ?, ?, ?)", agent, rating, text, now);
	}
	feedback(agent: string, limit = FEEDBACK_SHOWN): { rating: string; text: string }[] {
		return this.sql<{ rating: string; text: string }>("SELECT rating, text FROM feedback WHERE agent = ? ORDER BY id DESC LIMIT ?", agent, limit);
	}
}

export const FEEDBACK_SHOWN = 10;
const GIST = 160;

/** The first meaningful line of a message, short: what a like or dislike was about. */
export const gist = (text: string) => {
	// A report message starts with "📄 <title>" then "#<job> · $<cost>": the title is the gist.
	const line = text.split("\n").map((l) => l.trim().replace(/^(📄|⚠️|📬 Needs you:)\s*/u, "")).find((l) => l && !/^#\d+ ·|^\$/.test(l)) ?? text.trim();
	return line.length > GIST ? `${line.slice(0, GIST - 1)}…` : line;
};

/** The section an agent gets: its recent likes and dislikes, newest first; empty when there are none. */
export function feedbackText(rows: readonly { rating: string; text: string }[]): string {
	if (!rows.length) return "";
	const mark = { up: "liked", down: "disliked", hide: "does not want to see this kind again" } as Record<string, string>;
	return [
		"How the operator reacted to your recent messages in Telegram. Do more of what they liked and less of what they did not; it says nothing about facts, only about what is useful to them.",
		...rows.map((r) => `- ${mark[r.rating] ?? r.rating}: ${r.text}`),
	].join("\n");
}
