// Standing notes: facts the operator wants an agent to keep ("my accountant is ...", "never book before 9").
// They live in the agent's own SQLite and render into its system prompt as a section, so they outlast /reset and
// compaction. pi only resends a section when it changes, so unchanged notes keep the prompt cache warm.
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable";
import type { Sql } from "./sql.ts";

export type Note = { id: number; text: string };

export const MAX_NOTES = 40;
export const MAX_NOTE_CHARS = 400;

export class NotesStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
		sql("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, text TEXT, created INTEGER)");
	}

	list(): Note[] {
		return this.sql<Note>("SELECT id, text FROM notes ORDER BY id");
	}

	/** `key` makes a replayed tool call land once. */
	add(key: string, text: string): string {
		const clean = text.trim().replace(/\s+/g, " ");
		if (!clean) return "Nothing to remember: the note is empty.";
		if (clean.length > MAX_NOTE_CHARS) return `Too long: keep a note under ${MAX_NOTE_CHARS} characters.`;
		const existing = this.sql<Note>("SELECT id, text FROM notes WHERE key = ?", key)[0];
		if (existing) return `Noted as #${existing.id}.`;
		if (this.list().length >= MAX_NOTES) return `There are already ${MAX_NOTES} notes. Forget an outdated one first.`;
		this.sql("INSERT INTO notes (key, text, created) VALUES (?, ?, ?)", key, clean, Date.now());
		return `Noted as #${this.sql<{ id: number }>("SELECT id FROM notes WHERE key = ?", key)[0]!.id}.`;
	}

	remove(id: number): string {
		const had = this.sql<Note>("SELECT id, text FROM notes WHERE id = ?", id)[0];
		if (!had) return `No note #${id}.`;
		this.sql("DELETE FROM notes WHERE id = ?", id);
		return `Forgot #${id}: ${had.text}`;
	}

	/** The prompt section, or undefined when there are none (pi then leaves the section out). */
	render(): string | undefined {
		const notes = this.list();
		if (!notes.length) return undefined;
		return [
			"Standing notes from the operator. They hold across conversations; follow them unless the operator says otherwise now.",
			...notes.map((n) => `#${n.id} ${n.text}`),
		].join("\n");
	}

	text(): string {
		return this.render() ?? "No standing notes yet. Ask the agent to remember something.";
	}
}

const reply = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export const notesKit = (store: NotesStore): Extension =>
	defineExtension({
		name: "notes",
		sections: [section("standing_notes", () => store.render())],
		tools: [
			defineTool({
				name: "remember",
				description:
					"Keep a standing note: a durable fact or preference of the operator's that should hold in every future conversation. " +
					"Use it when the operator asks you to remember something, not for passing details of the current task.",
				parameters: Type.Object({ note: Type.String({ description: `One fact, under ${MAX_NOTE_CHARS} characters` }) }),
				replay: "safe",
				execute: async ({ note }, api) => reply(store.add(`remember:${api.taskId}`, note)),
			}),
			defineTool({
				name: "forget",
				description: "Remove a standing note by its number, when the operator asks or it is clearly outdated.",
				parameters: Type.Object({ id: Type.Integer({ description: "Note number, as shown with #" }) }),
				replay: "safe",
				execute: async ({ id }) => reply(store.remove(id)),
			}),
		],
	});
