// Repo views in the cloud: the files the server's sync uploaded, and the writes agents queue for it to commit.
// Agents read a view with pending writes already applied, so a multi-step job sees its own earlier writes.
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { isViewName, matches, REPO_VIEWS, type ViewName, viewOf, writableIn } from "./repo-views.ts";
import type { Sql } from "./sql.ts";

export type WriteMode = "append" | "replace";
export type PendingWrite = { id: number; view: string; path: string; mode: WriteMode; content: string; note: string; agent: string };
export type WriteResult = { id: number; status: "committed" | "failed"; result: string };

/** What the repo tools and the sync call, as RPC. */
export type RepoApi = {
	files(view: string, dir?: string): Promise<string>;
	read(view: string, path: string, from?: number): Promise<string>;
	grep(view: string, pattern: string, glob?: string): Promise<string>;
	queueWrite(key: string, agent: string, view: string, path: string, mode: WriteMode, content: string, note: string): Promise<string>;
};

const READ_CHARS = 30_000;
const MAX_WRITE_CHARS = 200_000;
const GREP_MAX = 80;

export class RepoStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
		sql("CREATE TABLE IF NOT EXISTS repo_files (view TEXT, path TEXT, content TEXT, PRIMARY KEY (view, path))");
		sql("CREATE TABLE IF NOT EXISTS repo_meta (view TEXT PRIMARY KEY, revision TEXT, uploaded INTEGER)");
		sql("CREATE TABLE IF NOT EXISTS repo_writes (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, view TEXT, path TEXT, mode TEXT, content TEXT, note TEXT, agent TEXT, created INTEGER, status TEXT, result TEXT)");
	}

	/** The sync's upload: the view becomes exactly these files. */
	replace(view: string, files: Record<string, string>, revision: string, now = Date.now()) {
		this.sql("DELETE FROM repo_files WHERE view = ?", view);
		for (const [path, content] of Object.entries(files)) this.sql("INSERT INTO repo_files VALUES (?, ?, ?)", view, path, content);
		this.sql("INSERT OR REPLACE INTO repo_meta VALUES (?, ?, ?)", view, revision, now);
	}

	private pendingFor(view: string, path?: string): PendingWrite[] {
		return path
			? this.sql<PendingWrite>("SELECT id, view, path, mode, content, note, agent FROM repo_writes WHERE view = ? AND path = ? AND status = 'pending' ORDER BY id", view, path)
			: this.sql<PendingWrite>("SELECT id, view, path, mode, content, note, agent FROM repo_writes WHERE view = ? AND status = 'pending' ORDER BY id", view);
	}

	/** A file as agents see it: the uploaded copy with this view's pending writes applied in order. */
	content(view: string, path: string): string | undefined {
		let text = this.sql<{ content: string }>("SELECT content FROM repo_files WHERE view = ? AND path = ?", view, path)[0]?.content;
		for (const w of this.pendingFor(view, path)) text = w.mode === "replace" ? w.content : `${text ?? ""}${text && !text.endsWith("\n") ? "\n" : ""}${w.content}`;
		return text;
	}

	paths(view: string): string[] {
		const uploaded = this.sql<{ path: string }>("SELECT path FROM repo_files WHERE view = ?", view).map((r) => r.path);
		return [...new Set([...uploaded, ...this.pendingFor(view).map((w) => w.path)])].sort();
	}

	files(view: string, dir = ""): string {
		const meta = this.sql<{ revision: string; uploaded: number }>("SELECT revision, uploaded FROM repo_meta WHERE view = ?", view)[0];
		if (!meta) return `The view ${view} has not been uploaded yet; the server's sync does that every 15 minutes.`;
		const prefix = dir.replace(/^\/+|\/+$/g, "");
		const list = this.paths(view).filter((p) => !prefix || p.startsWith(`${prefix}/`));
		const lines = list.map((p) => `${p} · ${(this.content(view, p)?.length ?? 0).toLocaleString("en")} chars`);
		return `${view} at ${meta.revision.slice(0, 8)}, uploaded ${new Date(meta.uploaded).toISOString().slice(0, 16)}Z · ${list.length} files\n${lines.join("\n")}`;
	}

	read(view: string, path: string, from = 0): string {
		const text = this.content(view, path);
		if (text === undefined) return `No file ${path} in ${view}. List the files with repo_files.`;
		const page = text.slice(from, from + READ_CHARS);
		const more = from + READ_CHARS < text.length ? `\n\n[continues: repo_read from=${from + READ_CHARS} of ${text.length}]` : "";
		return `${path}${from ? ` from ${from}` : ""}:\n${page}${more}`;
	}

	/** Lines matching a regular expression (case-insensitive), as path:line: text. */
	grep(view: string, pattern: string, glob?: string): string {
		let re: RegExp;
		try {
			re = new RegExp(pattern, "i");
		} catch {
			return `Not a valid regular expression: ${pattern}`;
		}
		const hits: string[] = [];
		for (const path of this.paths(view)) {
			if (glob && !matches(path, glob)) continue;
			const lines = (this.content(view, path) ?? "").split("\n");
			for (let i = 0; i < lines.length && hits.length < GREP_MAX; i++) if (re.test(lines[i]!)) hits.push(`${path}:${i + 1}: ${lines[i]!.slice(0, 300)}`);
			if (hits.length >= GREP_MAX) break;
		}
		return hits.length ? hits.join("\n") + (hits.length >= GREP_MAX ? `\n[first ${GREP_MAX} matches]` : "") : `No lines match ${pattern}.`;
	}

	/** `key` (the tool call's) makes a replayed call queue nothing new. */
	queueWrite(key: string, agent: string, view: string, path: string, mode: WriteMode, content: string, note: string, now = Date.now()): string {
		const done = this.sql<{ id: number }>("SELECT id FROM repo_writes WHERE key = ?", key)[0];
		if (done) return `Write #${done.id} is already queued.`;
		if (!isViewName(view)) return `No view ${view}.`;
		if (!writableIn(viewOf(view), path)) return `Not written: ${path} is not writable in ${view}. Writable: ${(viewOf(view).writable ?? []).join(", ") || "nothing"}.`;
		if (content.length > MAX_WRITE_CHARS) return `Not written: over ${MAX_WRITE_CHARS} characters.`;
		this.sql("INSERT INTO repo_writes (key, view, path, mode, content, note, agent, created, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')", key, view, path, mode, content, note.slice(0, 200), agent, now);
		const id = this.sql<{ id: number }>("SELECT id FROM repo_writes WHERE key = ?", key)[0]!.id;
		return `Write #${id} queued (${mode} ${path}). Your later reads already include it; the server commits it to git within 15 minutes, after the repo's own checks.`;
	}

	pending(view: string): PendingWrite[] {
		return this.pendingFor(view);
	}

	/** The sync's report on writes it applied; returns the ones that failed, for the operator to hear about. */
	ack(results: readonly WriteResult[]): (PendingWrite & { result: string })[] {
		const failed: (PendingWrite & { result: string })[] = [];
		for (const r of results) {
			const w = this.sql<PendingWrite>("SELECT id, view, path, mode, content, note, agent FROM repo_writes WHERE id = ? AND status = 'pending'", r.id)[0];
			if (!w) continue;
			this.sql("UPDATE repo_writes SET status = ?, result = ? WHERE id = ?", r.status, r.result.slice(0, 2000), r.id);
			if (r.status === "failed") failed.push({ ...w, result: r.result });
		}
		return failed;
	}
}

const reply = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** The repo tools, limited to the views the agent's fleet entry names. */
export function repoKit(repos: () => Promise<RepoApi>, agent: string, views: readonly ViewName[]): Extension {
	const viewParam = Type.Union(views.map((v) => Type.Literal(v)), { description: views.map((v) => `${v}: ${REPO_VIEWS[v].about}`).join(" | ") });
	const writable = views.filter((v) => (viewOf(v).writable ?? []).length);
	return defineExtension({
		name: "repo",
		tools: [
			defineTool({
				name: "repo_files",
				description: "List the files of a repo view you can read, optionally under one folder.",
				parameters: Type.Object({ view: viewParam, dir: Type.Optional(Type.String()) }),
				replay: "safe",
				execute: async ({ view, dir }) => reply(await (await repos()).files(view, dir)),
			}),
			defineTool({
				name: "repo_read",
				description: "Read a file of a repo view, in pages of 30,000 characters.",
				parameters: Type.Object({ view: viewParam, path: Type.String(), from: Type.Optional(Type.Integer()) }),
				replay: "safe",
				execute: async ({ view, path, from }) => reply(await (await repos()).read(view, path, from ?? 0)),
			}),
			defineTool({
				name: "repo_grep",
				description: "Find lines matching a regular expression (case-insensitive) across a repo view, optionally only in paths matching a glob such as domains/*.md.",
				parameters: Type.Object({ view: viewParam, pattern: Type.String(), path: Type.Optional(Type.String({ description: "Glob" })) }),
				replay: "safe",
				execute: async ({ view, pattern, path }) => reply(await (await repos()).grep(view, pattern, path)),
			}),
			defineTool({
				name: "repo_write",
				description:
					`Append to or replace a file in a repo view you may write (${writable.join(", ") || "none"}), as the repo's own rules prescribe. ` +
					"The server commits it to git after the repo's checks; if a check fails the write is dropped and you are told.",
				parameters: Type.Object({
					view: viewParam,
					path: Type.String(),
					mode: Type.Union([Type.Literal("append"), Type.Literal("replace")]),
					content: Type.String(),
					note: Type.String({ description: "One line for the commit message" }),
				}),
				replay: "safe",
				execute: async ({ view, path, mode, content, note }, api) => reply(await (await repos()).queueWrite(`write:${api.taskId}`, agent, view, path, mode, content, note)),
			}),
		],
	});
}
