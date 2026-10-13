// The Director: one Durable Object ("main") that owns the fleet's shared state and every Telegram message. It is
// only the platform's side: storage, schedules, the real Telegram, agents, Google and library behind the ports of
// director/context.ts, and the RPC surface other objects call. What it does lives in director/services.ts.
import { Agent, getAgentByName } from "agents";
import type { FleetAgent } from "./agent.ts";
import type { ModelId } from "./anthropic.ts";
import { readTextDocument } from "./attachments.ts";
import { LEAD } from "./fleet.ts";
import type { DirectorApi } from "./lead.ts";
import { library } from "./library-object.ts";
import { google } from "./google/connector.ts";
import type { SkillsApi } from "./skills.ts";
import { plugins } from "./plugins.gen.ts";
import { BUNDLED_SKILLS } from "./skills.gen.ts";
import { type SecretName, secret } from "./secrets.ts";
import { storageSql } from "./sql.ts";
import { bot, type Update } from "./telegram.ts";
import { transcribe } from "./voice.ts";
import type { AgentPort, Ctx, TelegramPort } from "./director/context.ts";
import { migrate } from "./director/schema.ts";
import { buildServices, type Services } from "./director/services.ts";

export { formatStatus } from "./director/fleet.ts";

export class Director extends Agent<Env> implements DirectorApi, SkillsApi {
	#s?: Services;
	/** The services, built on first use over this object's storage and the platform. */
	private get s(): Services {
		if (this.#s) return this.#s;
		const env = this.env;
		const ctx: Ctx = {
			sql: storageSql(this.ctx.storage),
			now: () => Date.now(),
			tg: async () => (await bot(env)) as TelegramPort,
			agent: async (name) => (await getAgentByName(env.FleetAgent as DurableObjectNamespace<FleetAgent>, name)) as unknown as AgentPort,
			google: () => google(env),
			library: () => library(env),
			schedules: {
				at: async (when, callback, payload) => void (await this.schedule(when, callback as keyof this, payload)),
				cancel: async (id) => void (await this.cancelSchedule(id)),
				list: () => this.getSchedules().map((s) => ({ id: s.id, callback: s.callback, type: s.type, time: s.time, payload: s.payload })),
			},
			media: { transcribe: (voice) => transcribe(env, voice), readDocument: async (doc) => readTextDocument(await bot(env), doc) },
			publicUrl: env.PUBLIC_URL,
			secret: (name) => secret(env, name as SecretName, { fresh: true }),
		};
		return (this.#s = buildServices(ctx, BUNDLED_SKILLS, plugins()));
	}

	async onStart() {
		migrate(storageSql(this.ctx.storage));
		// Both replaced by tick: the queue, and the nightly cost line (now at the owner's local hour, see Digests.run).
		for (const s of this.getSchedules()) if (s.callback === "startQueued" || s.callback === "nightly") await this.cancelSchedule(s.id);
		await this.scheduleEvery(15 * 60, "tick");
		if (!this.s.kv.get("views_since")) this.s.kv.set("views_since", String(Date.now())); // page opens are counted from here on
		await this.s.routines.syncSchedules();
		this.s.skills.dropSuperseded();
	}

	/** Every 15 minutes: start what waited, a wish if credit is spare, the mail watch, the digests, and wake stalled agents. */
	async tick() {
		const s = this.s;
		s.kv.set("last_tick", String(Date.now()));
		await s.routines.syncSchedules();
		await s.jobs.startQueued();
		await s.wishes.startNext().catch((err) => console.error("wish start failed:", err));
		await s.digests.run().catch((err) => console.error("digests failed:", err));
		await s.reminders.due().catch((err) => console.error("reminders failed:", err));
		await s.plugin.tick();
		for (const name of new Set<string>([LEAD, ...s.jobs.workers()])) {
			const agent = (await getAgentByName(this.env.FleetAgent as DurableObjectNamespace<FleetAgent>, name)) as unknown as AgentPort;
			const pending = await agent.nudge().catch((err) => (console.error(`nudge ${name} failed:`, err), 0));
			if (pending) console.log(`tick: ${name} has ${pending} pending`);
		}
	}

	async runRoutine({ id }: { id: number }) {
		await this.s.routines.run(id);
	}
	async startQueued() {
		await this.s.jobs.startQueued();
	}

	// ---- Telegram ----------------------------------------------------------------------------------------------

	async dispatch(update: Update) {
		await this.s.commands.dispatch(update);
	}
	async button(cb: NonNullable<Update["callback_query"]>) {
		await this.s.buttons.handle(cb);
	}
	async reaction(messageId: number, added: string[]) {
		await this.s.reactions.react(messageId, added);
	}
	async noteSent(messageId: number, s: { agent?: string; kind: string; job?: number; gmail?: string; text: string }) {
		this.s.sent.note(messageId, s);
	}

	// ---- Agents: budget, jobs, alerts --------------------------------------------------------------------------

	async check(who: string, wish?: boolean): Promise<string | undefined> {
		return this.s.spend.check(who, wish);
	}
	async addSpend(agent: string, model: string, amount: number) {
		this.s.spend.add(agent, model, amount);
	}
	/** alert_operator's daily limit: true the first time `agent` asks on `day` (UTC), false after. */
	async claimAlert(agent: string, day: string): Promise<boolean> {
		if (this.s.kv.get(`alert:${agent}`) === day) return false;
		this.s.kv.set(`alert:${agent}`, day);
		return true;
	}
	async jobDone(id: number, status: "done" | "failed", summary: string, cost: number, title?: string, messageId?: number) {
		await this.s.jobs.done(id, status, summary, cost, title, messageId);
	}

	// ---- The Lead's tools (lead.ts) ----------------------------------------------------------------------------

	async createJob(key: string, agent: string, task: string, project?: string, skills: string[] = [], model?: ModelId, inputs: number[] = []): Promise<string> {
		return this.s.jobs.create(key, agent, task, project, skills, model, inputs);
	}
	async listJobs(): Promise<string> {
		return this.s.jobs.list();
	}
	async cancelJob(id: number): Promise<string> {
		return this.s.jobs.cancel(id);
	}
	async saveProject(name: string, goal: string, context: string): Promise<string> {
		return this.s.projects.save(name, goal, context);
	}
	async listProjects(): Promise<string> {
		return this.s.projects.list();
	}
	async saveRoutine(name: string, agent: string, cron: string, task: string, project?: string, skills: string[] = [], model?: string): Promise<string> {
		return this.s.routines.save(name, agent, cron, task, project, skills, model);
	}
	async listRoutines(): Promise<string> {
		return this.s.routines.list();
	}
	async moveRoutine(id: number, cron: string): Promise<string> {
		return this.s.routines.move(id, cron);
	}
	async cancelRoutine(id: number): Promise<string> {
		return this.s.routines.cancel(id);
	}
	async addWish(key: string, agent: string, task: string, project?: string, model?: string): Promise<string> {
		return this.s.wishes.add(key, agent, task, project, model);
	}
	async listWishes(): Promise<string> {
		return this.s.wishes.list();
	}
	async dropWish(id: number): Promise<string> {
		return this.s.wishes.drop(id);
	}

	// ---- Skills (skills.ts) ------------------------------------------------------------------------------------

	async skillCatalog(agent: string) {
		return this.s.skills.catalog(agent);
	}
	async readSkill(agent: string, name: string, file?: string) {
		return this.s.skills.read(agent, name, file);
	}
	async saveSkill(by: string, name: string, description: string, body: string, agents: string[]) {
		return this.s.skills.save(by, name, description, body, agents);
	}
	async installSkill(by: string, url: string, agents: string[]) {
		return this.s.skills.install(by, url, agents);
	}
	async deleteSkill(by: string, name: string) {
		return this.s.skills.remove(by, name);
	}
	async exportSkills() {
		return this.s.skills.store.list();
	}

	// ---- The server's sync and diagnostics (sync-export.ts) -----------------------------------------------------

	/** The fleet's own state as plain data, for the server-only private archive. */
	async stateSnapshot(): Promise<Record<string, unknown>> {
		const s = this.s;
		const sql = storageSql(this.ctx.storage);
		return {
			credit: s.spend.credit(),
			models: s.fleet.switchedModels(),
			leadNotes: await ((await getAgentByName(this.env.FleetAgent as DurableObjectNamespace<FleetAgent>, LEAD)) as unknown as AgentPort).notesText(),
			projects: s.projects.all(),
			routines: sql("SELECT id, name, agent, cron, task, project, skills, created, last_run, last_job FROM routines ORDER BY id"),
			wishes: s.wishes.store.all(),
			jobs: sql("SELECT id, agent, model, project, task, status, created, started, finished, cost, summary FROM jobs ORDER BY id"),
			spendByDay: sql("SELECT date(at / 1000, 'unixepoch') AS day, agent, model, ROUND(SUM(usd), 4) AS usd FROM spend GROUP BY day, agent, model ORDER BY day, agent, model"),
		};
	}
	/** The deploy pipeline reports here; only a failure makes a sound. */
	async deployNotice(ok: boolean, text: string, changes: string[] = []) {
		await (await bot(this.env)).say(undefined, ok ? `🚀 ${text}` : `❌ ${text}`, { silent: ok });
		if (ok && changes.length) await this.s.fleet.shipped(changes);
	}
	async budgetReport(): Promise<string> {
		return this.s.spend.text(this.s.wishes.store.waiting());
	}
	async syncHealth(problems: string[]) {
		this.s.digests.syncReport(problems);
	}
	/** The home server's call into a plugin's Director part (sync-export.ts, POST /sync/plugin/<name>/<method>). */
	async pluginRpc(name: string, method: string, args: unknown): Promise<unknown> {
		return this.s.plugin.rpc(name, method, args);
	}

	/** For `npm run smoke` (via /sync/diag/health): the state a person would otherwise check by hand; counts only. */
	async health() {
		const s = this.s;
		const now = Date.now();
		const sql = storageSql(this.ctx.storage);
		const count = (q: string, ...p: number[]) => sql<{ n: number }>(q, ...p)[0]!.n;
		const g = await google(this.env).status().catch(() => undefined);
		const a = s.spend.allowanceNow();
		return {
			now,
			lastTick: Number(s.kv.get("last_tick") ?? 0),
			...s.digests.state(),
			jobs: {
				running: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'running'"),
				queued: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'"),
				failedToday: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed' AND finished > ?", now - 86_400_000),
				stuck: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'running' AND started < ?", now - 3 * 3_600_000),
			},
			routines: count("SELECT COUNT(*) AS n FROM routines"),
			scheduledRoutines: this.getSchedules().filter((x) => x.callback === "runRoutine").length,
			plugins: plugins().map((p) => p.name),
			// The google plugin's new-mail triage; undefined without the plugin.
			mailWatch: s.plugin.part<{ mailWatchOn(): boolean }>("google")?.mailWatchOn(),
			google: g ? { configured: g.configured, connected: g.connected, missing: g.missing ?? null } : null,
			budget: { leftUsd: a.leftUsd, todayUsd: a.todayUsd, spentTodayUsd: a.spentTodayUsd, daysLeft: a.daysLeft, expired: a.expired },
			topics: s.fleet.topicCount(),
		};
	}
}
