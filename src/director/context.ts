// What the Director's services work with: small ports instead of the platform, so the same code runs in the Durable
// Object and in tests (test-kit.ts). The Director (../director.ts) builds the real ones; nothing here imports
// Cloudflare or the Agents SDK.
import type { AgentStatus, JobRef } from "../agent.ts";
import type { ModelId } from "../anthropic.ts";
import type { ApiRequest } from "../google/allow.ts";
import type { GoogleResponse, GoogleStatus, GrantedFile } from "../google/connector.ts";
import type { Report } from "../library.ts";
import type { Sql } from "../sql.ts";
import type { Button, Document, SendOptions } from "../telegram.ts";
import type { VoiceFile } from "../voice.ts";

/** The fleet's Telegram group. `thread` undefined is the General topic. */
export interface TelegramPort {
	readonly chat: string;
	say(thread: number | undefined, text: string, opts?: SendOptions): Promise<number | undefined>;
	edit(messageId: number, text: string, buttons?: Button[][]): Promise<void>;
	answer(callbackId: string, text?: string): Promise<void>;
	sendFile(thread: number | undefined, filename: string, content: string, caption?: string, opts?: SendOptions): Promise<number | undefined>;
	call<T = unknown>(method: string, body: object): Promise<T>;
}

/** One fleet agent (or a job worker `<agent>~<job>`), as the Director calls it. */
export interface AgentPort {
	receive(updateId: number, text: string): Promise<void>;
	runJob(job: JobRef, thread: number | undefined, model: ModelId): Promise<void>;
	jobResult(id: number, agent: string, status: string, summary: string, quiet?: boolean): Promise<void>;
	stop(): Promise<void>;
	pause(on: boolean): Promise<void>;
	reset(): Promise<void>;
	status(): Promise<AgentStatus>;
	trace(last?: number, full?: boolean): Promise<string>;
	notesText(): Promise<string>;
	mcpText(): Promise<string>;
	setModel(model: ModelId): Promise<void>;
	setThread(thread: number): Promise<void>;
	nudge(): Promise<number>;
	setFeedback(text: string): Promise<void>;
	/** What shipped lately (news.ts), shown in the agent's instructions until `until` (ms). */
	setNews(text: string, until: number): Promise<void>;
	explain(messageId: number, text: string): Promise<void>;
}

/** The Google connector: every request checked against allow.ts there. */
export interface GooglePort {
	status(): Promise<GoogleStatus>;
	request(agent: string, req: ApiRequest): Promise<GoogleResponse>;
	connectUrl(redirect: string): Promise<string>;
	disconnect(): Promise<boolean>;
	grant(id: string, kind?: "doc" | "sheet"): Promise<GrantedFile>;
	ungrant(id: string): Promise<boolean>;
	files(): Promise<{ granted: GrantedFile[]; created: number }>;
	fleetDrafts(): Promise<number>;
}

export interface LibraryPort {
	jobReport(job: number): Promise<Report | undefined>;
	search(query: string): Promise<string>;
	pagesOpened(paths: string[]): Promise<string[]>;
}

export type ScheduleInfo = { id: string; callback: string; type: string; time: number; payload: unknown };
/** The Durable Object's alarms-backed schedules (the Agents SDK). */
export interface SchedulePort {
	at(when: Date, callback: string, payload: unknown): Promise<void>;
	cancel(id: string): Promise<void>;
	list(): ScheduleInfo[];
}

/** Things only the platform can do for a message: hear a voice note, read a file. */
export interface MediaPort {
	transcribe(voice: VoiceFile): Promise<string>;
	readDocument(doc: Document): Promise<string>;
}

export type Ctx = {
	sql: Sql;
	now: () => number;
	tg: () => Promise<TelegramPort>;
	agent: (name: string) => Promise<AgentPort>;
	google: () => GooglePort;
	library: () => LibraryPort;
	schedules: SchedulePort;
	media: MediaPort;
	/** The Worker's own address, for Google's sign-in redirect. */
	publicUrl: string;
	/** A secret's current value (secrets.ts), for plugins that call an outside service; never to be shown or logged. */
	secret: (name: string) => Promise<string>;
};

/** The Director's small key-value table. */
export class Kv {
	private readonly sql: Sql;
	constructor(sql: Sql) {
		this.sql = sql;
	}
	get(key: string): string | undefined {
		return this.sql<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)[0]?.value;
	}
	set(key: string, value: string) {
		this.sql("INSERT OR REPLACE INTO kv VALUES (?, ?)", key, value);
	}
	delete(key: string) {
		this.sql("DELETE FROM kv WHERE key = ?", key);
	}
	json<T>(key: string, fallback: T): T {
		const v = this.get(key);
		return v ? (JSON.parse(v) as T) : fallback;
	}
}

/** Says something in General. */
export const general = async (ctx: Ctx, text: string, opts?: SendOptions) => (await ctx.tg()).say(undefined, text, opts);

export const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
export const age = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
