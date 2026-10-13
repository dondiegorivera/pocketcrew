// Jobs: created with their checks (specialist, project, skills, chained inputs and the flow rule), started on slots and
// budget (a worker of their own when parallel or on their own model), finished and routed by where they came from
// (digest.ts jobKind): a hook per kind, the Lead by default.
import type { JobInput, JobRef } from "../agent.ts";
import { isModelId, type ModelId } from "../anthropic.ts";
import { type DoneJob, needsOperator } from "../digest.ts";
import { FLEET, isAgentName, LEAD, LIMITS, specialists } from "../fleet.ts";
import { inputProblem, reportsToLead } from "../safety.ts";
import { parseStatus, privateResultLine } from "../jobs.ts";
import { feedbackText, type SentStore } from "../reactions.ts";
import { age, type Ctx, usd } from "./context.ts";
import type { Projects } from "./projects.ts";
import type { JobRow } from "./schema.ts";
import type { Skills } from "./skills.ts";
import type { Spend } from "./spend.ts";

const MAX_INPUTS = 5;

/** A finished job, as a hook gets it. `forLead`: what the Lead may hear (fixed fields for private agents). */
export type Finished = { job: JobRow; status: "done" | "failed"; title?: string; forLead: string; needsOperator: boolean };
export type DoneHook = (f: Finished) => Promise<unknown>;

export class Jobs {
	/** What happens when a job finishes, by the start of its key (`mailwatch:`, `routine:` …); without one, the Lead hears. */
	private readonly hooks = new Map<string, DoneHook>();

	/** Claims the jobs whose key starts with `prefix`. */
	onDone(prefix: string, hook: DoneHook) {
		if (this.hooks.has(prefix)) throw new Error(`job key prefix "${prefix}" is taken`);
		this.hooks.set(prefix, hook);
	}

	private readonly ctx: Ctx;
	private readonly spend: Spend;
	private readonly skills: Skills;
	private readonly projects: Projects;
	private readonly sent: SentStore;
	private readonly threadOf: (agent: string) => number | undefined;
	private readonly modelOf: (agent: string) => ModelId;
	constructor(ctx: Ctx, spend: Spend, skills: Skills, projects: Projects, sent: SentStore, threadOf: (agent: string) => number | undefined, modelOf: (agent: string) => ModelId) {
		this.ctx = ctx;
		this.spend = spend;
		this.skills = skills;
		this.projects = projects;
		this.sent = sent;
		this.threadOf = threadOf;
		this.modelOf = modelOf;
	}

	get(id: number): JobRow | undefined {
		return this.ctx.sql<JobRow>("SELECT * FROM jobs WHERE id = ?", id)[0];
	}
	byKey(key: string): JobRow | undefined {
		return this.ctx.sql<JobRow>("SELECT * FROM jobs WHERE key = ?", key)[0];
	}

	/**
	 * `model` runs this job alone on that model, on its own worker; without it the job takes the agent's current model.
	 * `inputs`: finished jobs whose full reports the specialist gets with the brief (chained work), when the flow rule
	 * allows it (fleet.ts inputProblem): private results only reach private agents with no way out.
	 */
	async create(key: string, agent: string, task: string, project?: string, skills: string[] = [], model?: ModelId, inputs: number[] = []): Promise<string> {
		const existing = this.byKey(key);
		if (existing) return `Job #${existing.id} (${existing.agent}) is ${existing.status}.`;
		if (!isAgentName(agent) || FLEET[agent].role !== "specialist") return `No specialist "${agent}". Specialists: ${specialists().join(", ")}.`;
		if (project && !this.projects.get(project)) return `No project card "${project}". Save it first with save_project, or leave project out.`;
		const unusable = this.skills.unusable(agent, skills);
		if (unusable) return unusable;
		const ins = [...new Set(inputs)];
		if (ins.length > MAX_INPUTS) return `At most ${MAX_INPUTS} input jobs.`;
		for (const n of ins) {
			const src = this.get(n);
			if (!src) return `No job #${n}.`;
			if (src.status !== "done") return `Job #${n} is ${src.status}; only finished jobs can be inputs. Dispatch this when it is done.`;
		}
		const flow = inputProblem(agent, ins.map((n) => this.get(n)!.agent));
		if (flow) return `Not dispatched: ${flow}`;
		this.ctx.sql(
			"INSERT INTO jobs (key, agent, task, project, skills, model, inputs, status, created) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
			key, agent, task, project ?? null, JSON.stringify(skills), model ?? null, ins.length ? JSON.stringify(ins) : null, this.ctx.now(),
		);
		const id = this.byKey(key)!.id;
		await this.startQueued();
		if (this.get(id)!.status === "running") return `Job #${id} started with ${agent}. Its result will come back to you as [job #${id}].`;
		const why = this.spend.check(agent) ?? "every slot for that agent is busy";
		return `Job #${id} is queued for ${agent} (${why}). It starts on its own when that clears.`;
	}

	/** Starts queued jobs, oldest first, while slots and budget allow. Runs after each change and every 15 min. */
	async startQueued() {
		for (const job of this.ctx.sql<JobRow>("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id")) {
			if (!isAgentName(job.agent)) continue;
			const spec = FLEET[job.agent];
			const runningAll = this.ctx.sql<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status = 'running'")[0]!.n;
			const runningMine = this.ctx.sql<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status = 'running' AND agent = ?", job.agent)[0]!.n;
			if (runningAll >= LIMITS.maxConcurrentJobs || runningMine >= spec.parallelJobs) continue;
			if (this.spend.check(job.agent, job.key.startsWith("wish:"))) continue;
			// Above one job at a time, every job gets its own worker object, so jobs run side by side. A job with its own
			// model gets one too, so the agent's conversation keeps the operator's model.
			const model = job.model && isModelId(job.model) ? job.model : undefined;
			const worker = spec.parallelJobs > 1 || model ? `${job.agent}~${job.id}` : job.agent;
			this.ctx.sql("UPDATE jobs SET status = 'running', worker = ?, started = ? WHERE id = ?", worker, this.ctx.now(), job.id);
			const ref: JobRef = {
				id: job.id,
				agent: job.agent,
				task: job.task,
				project: job.project ? this.projects.get(job.project) : undefined,
				skills: this.skills.texts(JSON.parse(job.skills ?? "[]") as string[]),
				inputs: await this.inputReports(JSON.parse(job.inputs ?? "[]") as number[]),
				feedback: feedbackText(this.sent.feedback(job.agent)) || undefined,
			};
			try {
				await (await this.ctx.agent(worker)).runJob(ref, this.threadOf(job.agent), model ?? this.modelOf(job.agent));
			} catch (err) {
				this.ctx.sql("UPDATE jobs SET status = 'failed', finished = ?, summary = ? WHERE id = ?", this.ctx.now(), String(err), job.id);
				console.error(`job ${job.id} did not start:`, err);
			}
		}
	}

	/** The full reports of input jobs, re-checked at start: one missing (an archive failure) is named, not skipped silently. */
	private async inputReports(ids: number[]): Promise<JobInput[]> {
		const lib = this.ctx.library();
		return Promise.all(
			ids.map(async (n) => {
				const r = await lib.jobReport(n);
				return r ? { job: n, agent: r.agent, title: r.title, body: r.body } : { job: n, agent: "?", title: "missing", body: `The report of job #${n} could not be found; say so in your answer.` };
			}),
		);
	}

	/**
	 * A job finished. Recorded, its report message kept for reactions, then routed: the hook for its kind, or the Lead.
	 * Results built from private data stay with the operator: the Lead gets the checked fixed fields only.
	 */
	async done(id: number, status: "done" | "failed", summary: string, cost: number, title?: string, messageId?: number) {
		const job = this.get(id);
		if (!job || job.status !== "running") return; // cancelled meanwhile: the Lead already knows
		this.ctx.sql(
			"UPDATE jobs SET status = ?, finished = ?, cost = ?, summary = ?, title = ?, message_id = ? WHERE id = ?",
			status, this.ctx.now(), cost, summary, title ?? null, messageId === undefined ? null : String(messageId), id,
		);
		if (messageId !== undefined) this.sent.note(messageId, { agent: job.agent, kind: "report", job: id, text: `📄 ${title ?? job.task.split("\n")[0]}` });
		const forLead = reportsToLead(job.agent) ? summary : privateResultLine(job.agent, status === "done" ? parseStatus(summary, specialists()) : undefined);
		const finished: Finished = { job: this.get(id)!, status, title, forLead, needsOperator: status === "done" && needsOperator(summary, specialists()) };
		const hook = [...this.hooks].find(([prefix]) => job.key.startsWith(prefix))?.[1];
		if (hook) await hook(finished);
		else await (await this.ctx.agent(LEAD)).jobResult(id, job.agent, status, forLead);
		await this.startQueued();
	}

	async cancel(id: number): Promise<string> {
		const job = this.get(id);
		if (!job) return `No job #${id}.`;
		if (job.status !== "queued" && job.status !== "running") return `Job #${id} is already ${job.status}.`;
		if (job.status === "running" && job.worker) await (await this.ctx.agent(job.worker)).stop();
		this.ctx.sql("UPDATE jobs SET status = 'cancelled', finished = ? WHERE id = ?", this.ctx.now(), id);
		await this.startQueued();
		return `Job #${id} cancelled.`;
	}

	list(): string {
		const now = this.ctx.now();
		const rows = this.ctx.sql<JobRow>("SELECT * FROM jobs WHERE status IN ('queued', 'running') OR created > ? ORDER BY id DESC LIMIT 20", now - 86_400_000);
		if (!rows.length) return "No jobs in the last 24 hours.";
		const icon: Record<string, string> = { queued: "⏳", running: "▶️", done: "✅", failed: "⚠️", cancelled: "⏹" };
		return rows
			.map((j) => `${icon[j.status] ?? "·"} #${j.id} ${j.agent}${j.model ? ` · ${j.model.replace("claude-", "")}` : ""}${j.project ? ` [${j.project}]` : ""} · ${age(now - j.created)} ago${j.cost != null ? ` · ${usd(j.cost)}` : ""}\n   ${j.task.split("\n")[0]!.slice(0, 120)}`)
			.join("\n");
	}

	running(agent?: string): number {
		return agent
			? this.ctx.sql<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status = 'running' AND agent = ?", agent)[0]!.n
			: this.ctx.sql<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status = 'running'")[0]!.n;
	}
	workers(): string[] {
		return this.ctx.sql<{ worker: string }>("SELECT DISTINCT worker FROM jobs WHERE status = 'running' AND worker IS NOT NULL").map((r) => r.worker);
	}
	/** Jobs whose key starts with `prefix`, in these states. */
	withKey(prefix: string, states: readonly string[]): DoneJob[] {
		return this.ctx.sql<DoneJob>(`SELECT * FROM jobs WHERE key LIKE ? AND status IN (${states.map(() => "?").join(", ")}) ORDER BY id`, `${prefix}%`, ...states);
	}
}
