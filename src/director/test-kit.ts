// Tests only: the Director's services over fakes. A fake Telegram that records what was said, edited and answered;
// fake agents that record calls; a fake Google that applies the real allow-list (google/allow.ts) before answering
// from routes a test sets; a fake library; schedules in memory; a clock the test moves.
import type { AgentStatus, JobRef } from "../agent.ts";
import { allow, type ApiRequest } from "../google/allow.ts";
import type { GoogleResponse, GoogleStatus } from "../google/connector.ts";
import type { Report } from "../library.ts";
import { BUNDLED_SKILLS } from "../skills.gen.ts";
import { memorySql } from "../test-sql.ts";
import type { Button, SendOptions, Update } from "../telegram.ts";
import type { AgentPort, Ctx, GooglePort, LibraryPort, ScheduleInfo, TelegramPort } from "./context.ts";
import type { Plugin } from "../plugin.ts";
import { migrate } from "./schema.ts";
import { buildServices } from "./services.ts";

export type Said = { id: number; thread?: number; text: string; opts?: SendOptions };

export class FakeTelegram implements TelegramPort {
	readonly chat = "-100";
	said: Said[] = [];
	edits: { id: number; text: string; buttons?: Button[][] }[] = [];
	answers: { id: string; text?: string }[] = [];
	files: { thread?: number; name: string; content: string }[] = [];
	calls: { method: string; body: object }[] = [];
	private next = 1000;
	async say(thread: number | undefined, text: string, opts?: SendOptions) {
		const id = this.next++;
		this.said.push({ id, thread, text, opts });
		return id;
	}
	async edit(id: number, text: string, buttons?: Button[][]) {
		this.edits.push({ id, text, buttons });
	}
	async answer(id: string, text?: string) {
		this.answers.push({ id, text });
	}
	async sendFile(thread: number | undefined, name: string, content: string) {
		this.files.push({ thread, name, content });
		return this.next++;
	}
	async call<T>(method: string, body: object): Promise<T> {
		this.calls.push({ method, body });
		return { message_thread_id: 500 + this.calls.length } as T;
	}
	last(): Said {
		return this.said.at(-1)!;
	}
}

export type AgentCall = { agent: string; method: string; args: unknown[] };

/** Every agent and job worker, recording calls; `status()` and `trace()` answer plainly. */
export function fakeAgents(calls: AgentCall[]): (name: string) => Promise<AgentPort> {
	return async (name) =>
		new Proxy({} as AgentPort, {
			// Not a thenable: `await ctx.agent(name)` must resolve to the proxy itself.
			get: (_t, method: string) => (method === "then" ? undefined : async (...args: unknown[]) => {
				calls.push({ agent: name, method, args });
				if (method === "status") return { name, title: name, model: "claude-haiku-5-5", busy: false, queued: 0, paused: false } satisfies AgentStatus;
				if (method === "nudge") return 0;
				return method === "trace" || method === "notesText" || method === "mcpText" ? `${method} of ${name}` : undefined;
			}),
		});
}

/** Google answering from `routes` (first match by method and URL substring), after the real allow-list. */
export class FakeGoogle implements GooglePort {
	requests: ApiRequest[] = [];
	routes: { method: string; match: string; data: unknown; status?: number }[] = [];
	statusValue: GoogleStatus = { configured: true, connected: true, email: "op@example.com", since: 0, missing: [] };
	async status() {
		return this.statusValue;
	}
	async request(_agent: string, req: ApiRequest): Promise<GoogleResponse> {
		const a = allow(req);
		if (typeof a === "string") return { ok: false, status: 403, data: { error: a } };
		this.requests.push(req);
		const r = this.routes.find((x) => x.method === req.method && req.url.includes(x.match));
		return { ok: (r?.status ?? 200) < 400, status: r?.status ?? 200, data: r ? r.data : {} };
	}
	async connectUrl() {
		return "https://accounts.example/consent";
	}
	async disconnect() {
		return true;
	}
	async grant(id: string) {
		return { id, kind: "doc" as const, title: "A doc", at: 0 };
	}
	async ungrant() {
		return true;
	}
	async files() {
		return { granted: [], created: 0 };
	}
	async fleetDrafts() {
		return 0;
	}
}

export class FakeLibrary implements LibraryPort {
	reports = new Map<number, Report>();
	opened: string[] = [];
	async jobReport(job: number) {
		return this.reports.get(job);
	}
	async search(q: string) {
		return `search: ${q}`;
	}
	async pagesOpened(paths: string[]) {
		return paths.filter((p) => this.opened.includes(p));
	}
}

/** A Director's services over fakes, at `start` (default Monday 2026-10-12 10:05 in Berlin), with these plugins. */
export function testDirector(start = Date.UTC(2026, 9, 12, 8, 5), plugins: readonly Plugin<any>[] = []) {
	const sql = memorySql();
	let now = start;
	migrate(sql, now);
	const tg = new FakeTelegram();
	const calls: AgentCall[] = [];
	const google = new FakeGoogle();
	const library = new FakeLibrary();
	const schedules: ScheduleInfo[] = [];
	let nextSchedule = 1;
	const ctx: Ctx = {
		sql,
		now: () => now,
		tg: async () => tg,
		agent: fakeAgents(calls),
		google: () => google,
		library: () => library,
		schedules: {
			at: async (when, callback, payload) => void schedules.push({ id: String(nextSchedule++), callback, type: "scheduled", time: Math.floor(when.getTime() / 1000), payload }),
			cancel: async (id) => void schedules.splice(schedules.findIndex((s) => s.id === id), 1),
			list: () => [...schedules],
		},
		media: { transcribe: async () => "heard words", readDocument: async () => "file text" },
		publicUrl: "https://fleet.example",
		secret: async (name) => `test-${name}`,
	};
	const s = buildServices(ctx, BUNDLED_SKILLS, plugins);
	return {
		s,
		sql,
		tg,
		calls,
		google,
		library,
		schedules,
		ctx,
		/** The services built again over the same storage, as after a restart or a deploy. */
		rebuild: () => buildServices(ctx, BUNDLED_SKILLS, plugins),
		setNow: (ms: number) => void (now = ms),
		advance: (ms: number) => void (now += ms),
		/** Calls an agent got, by method. */
		called: (method: string, agent?: string) => calls.filter((c) => c.method === method && (agent === undefined || c.agent === agent)),
		/** A message in General (or a topic) from the operator. */
		text: (text: string, thread?: number): Update => ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, chat: { id: -100, type: "supergroup" }, from: { id: 1 }, text, ...(thread !== undefined ? { message_thread_id: thread, is_topic_message: true } : {}) } }),
		/** A tap on a button with `data`, on message `messageId`. */
		tap: (data: string, messageId = 1000, text = "card") => ({ id: `cb${Math.floor(Math.random() * 1e9)}`, from: { id: 1 }, data, message: { message_id: messageId, chat: { id: -100 }, text } }),
	};
}

/** Marks a queued or running job done the way an agent would (Director.jobDone). */
export async function finish(t: ReturnType<typeof testDirector>, id: number, summary: string, title?: string, status: "done" | "failed" = "done", messageId?: number) {
	t.sql("UPDATE jobs SET status = 'running' WHERE id = ? AND status = 'queued'", id);
	await t.s.jobs.done(id, status, summary, 0.01, title, messageId);
}

export type { JobRef };
