// The fleet from the operator's side: which topic is whose, each agent's model (/model), what they are doing
// (/status), stopping, pausing, resetting, and /setup, which makes a topic for every specialist.
import { isModelId, MODEL_ALIASES, type ModelId } from "../anthropic.ts";
import { startOfDayUtc } from "../budget.ts";
import { type AgentName, FLEET, isAgentName, LEAD, specialists } from "../fleet.ts";
import type { AgentStatus } from "../agent.ts";
import { type Ctx, general, Kv, usd } from "./context.ts";
import { addNews, NEWS_DAYS, type NewsEntry, newsText } from "../news.ts";
import { dayLabel } from "../digest.ts";
import type { Jobs } from "./jobs.ts";
import type { Spend } from "./spend.ts";

export const formatStatus = (s: AgentStatus, spentToday: number, running: number) =>
	`${s.paused ? "⏸" : s.busy || running ? "▶️" : "💤"} ${s.title} (${s.name}) · ${s.model.replace("claude-", "")}` +
	`${running ? ` · ${running} job${running > 1 ? "s" : ""} running` : ""}${s.queued ? ` · ${s.queued} queued` : ""} · ${usd(spentToday)} today` +
	(s.lastError ? `\n   ⚠️ last request failed: ${s.lastError.slice(0, 300)}` : "");

export class Fleet {
	private readonly kv: Kv;
	/** Set once the services exist (they need the Fleet first): counts running jobs for /status. */
	jobs?: Jobs;
	private readonly ctx: Ctx;
	private readonly spend: Spend;
	constructor(ctx: Ctx, spend: Spend) {
		this.ctx = ctx;
		this.spend = spend;
		this.kv = new Kv(ctx.sql);
	}

	agentOfThread(thread: number | undefined): AgentName | undefined {
		if (thread === undefined) return undefined;
		const name = this.ctx.sql<{ agent: string }>("SELECT agent FROM topics WHERE thread = ?", thread)[0]?.agent;
		return name && isAgentName(name) ? name : undefined;
	}
	threadOf(name: string): number | undefined {
		return this.ctx.sql<{ thread: number }>("SELECT thread FROM topics WHERE agent = ?", name)[0]?.thread;
	}
	modelOf(name: string): ModelId {
		const o = this.kv.get(`model:${name}`);
		return o && isModelId(o) ? o : isAgentName(name) ? FLEET[name].model : FLEET.lead.model;
	}
	switchedModels(): Record<string, string> {
		return Object.fromEntries(this.ctx.sql<{ key: string; value: string }>("SELECT key, value FROM kv WHERE key LIKE 'model:%'").map((r) => [r.key.slice(6), r.value]));
	}

	/** Names a command argument stands for: one agent, or every agent for "all". */
	targets(arg: string): AgentName[] | string {
		if (arg === "all") return Object.keys(FLEET) as AgentName[];
		if (isAgentName(arg)) return [arg];
		return `Unknown agent "${arg}". Agents: ${Object.keys(FLEET).join(", ")}, or all.`;
	}

	async statusText(names: AgentName[]): Promise<string> {
		const since = startOfDayUtc(this.ctx.now());
		const lines = await Promise.all(names.map(async (n) => formatStatus(await (await this.ctx.agent(n)).status(), this.spend.spentSince(since, n), this.jobs?.running(n) ?? 0)));
		return lines.join("\n");
	}

	/** `/stop`, `/pause`, `/resume`, `/reset` for one agent or all. */
	async control(verb: "stop" | "pause" | "resume" | "reset", arg: string): Promise<string> {
		const names = this.targets(arg);
		if (typeof names === "string") return names;
		if (verb === "reset" && names.length > 1) return "Reset one agent at a time.";
		for (const n of names) {
			const agent = await this.ctx.agent(n);
			if (verb === "stop") await agent.stop();
			else if (verb === "reset") await agent.reset();
			else await agent.pause(verb === "pause");
		}
		return `${verb}: ${names.join(", ")} ✓`;
	}

	/** `/model` lists; `/model research sonnet` switches one agent from its next request on, until changed back. */
	async model(arg: string): Promise<string> {
		const [who, which] = arg.split(/\s+/).filter(Boolean);
		if (!who) return (Object.keys(FLEET) as AgentName[]).map((n) => `${n}: ${this.modelOf(n)}${this.kv.get(`model:${n}`) ? " (switched)" : ""}`).join("\n");
		if (!isAgentName(who)) return `Unknown agent "${who}". Agents: ${Object.keys(FLEET).join(", ")}.`;
		const model = which ? (MODEL_ALIASES[which.toLowerCase()] ?? which) : FLEET[who].model;
		if (!isModelId(model)) return `Unknown model "${which}". Use haiku, sonnet or opus.`;
		if (model === FLEET[who].model) this.kv.delete(`model:${who}`);
		else this.kv.set(`model:${who}`, model);
		await (await this.ctx.agent(who)).setModel(model);
		return `${who} now runs on ${model}${model === FLEET[who].model ? " (its fleet.ts default)" : ""}. Running job workers keep their model until they finish.`;
	}

	/** Creates the missing specialist topics. The bot must be an admin with "Manage topics". */
	async setup() {
		const made: string[] = [];
		const tg = await this.ctx.tg();
		for (const name of specialists()) {
			const spec = FLEET[name];
			let thread = this.threadOf(name);
			if (thread === undefined) {
				const topic = await tg.call<{ message_thread_id: number }>("createForumTopic", { chat_id: tg.chat, name: spec.title });
				thread = topic.message_thread_id;
				this.ctx.sql("INSERT INTO topics VALUES (?, ?)", name, thread);
				made.push(spec.title);
				await tg.say(thread, `${spec.title} here. The Lead sends me jobs; you can also write to me in this topic.`);
			}
			await (await this.ctx.agent(name)).setThread(thread);
		}
		const gone = this.ctx.sql<{ agent: string }>("SELECT agent FROM topics").map((r) => r.agent).filter((a) => !isAgentName(a) || FLEET[a].role !== "specialist");
		for (const a of gone) this.ctx.sql("DELETE FROM topics WHERE agent = ?", a);
		await general(
			this.ctx,
			[made.length ? `Created topics: ${made.join(", ")}.` : "Every specialist already has its topic.", gone.length ? `No longer in the fleet: ${gone.join(", ")}. You can close those topics in Telegram.` : ""].filter(Boolean).join("\n"),
		);
	}

	/** A deploy shipped these commits: the Lead reads them in its instructions for a week (news.ts). */
	async shipped(subjects: string[]) {
		const now = this.ctx.now();
		const news = addNews(this.kv.json<NewsEntry[]>("news", []), subjects, now);
		this.kv.set("news", JSON.stringify(news));
		const text = newsText(news, now, dayLabel);
		if (text) await (await this.ctx.agent(LEAD)).setNews(text, now + NEWS_DAYS * 86_400_000);
	}

	topicCount(): number {
		return this.ctx.sql<{ n: number }>("SELECT COUNT(*) AS n FROM topics")[0]!.n;
	}
}
