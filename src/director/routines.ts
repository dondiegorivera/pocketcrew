// Routines: jobs on a cron in the operator's time, one pending schedule each, a run as an ordinary job whose brief
// carries the operator's ratings of earlier runs.
import { ZONE_NAME } from "../config.ts";
import { isModelId, MODEL_ALIASES } from "../anthropic.ts";
import { routineIdOf } from "../digest.ts";
import { FLEET, isAgentName, specialists } from "../fleet.ts";
import { cronProblem, localStamp, nextRun, type Routine, routineBrief } from "../routines.ts";
import type { Ctx } from "./context.ts";
import type { Jobs } from "./jobs.ts";
import type { Projects } from "./projects.ts";
import type { JobRow } from "./schema.ts";
import type { Skills } from "./skills.ts";

export class Routines {
	private readonly ctx: Ctx;
	private readonly jobs: Jobs;
	private readonly projects: Projects;
	private readonly skills: Skills;
	constructor(
		ctx: Ctx,
		jobs: Jobs,
		projects: Projects,
		skills: Skills,
	) {
		this.ctx = ctx;
		this.jobs = jobs;
		this.projects = projects;
		this.skills = skills;
	}

	get(id: number): Routine | undefined {
		return this.ctx.sql<Routine>("SELECT * FROM routines WHERE id = ?", id)[0];
	}
	byName(name: string): Routine | undefined {
		return this.ctx.sql<Routine>("SELECT * FROM routines WHERE name = ?", name)[0];
	}
	all(): Routine[] {
		return this.ctx.sql<Routine>("SELECT * FROM routines ORDER BY id");
	}
	/** A routine job's name from its key (routine:<id>:<minute>), or the key itself. */
	nameOf(key: string): string {
		const id = routineIdOf(key);
		return id === undefined ? key : (this.get(id)?.name ?? `routine #${id}`);
	}

	/**
	 * One pending schedule per routine, at its next run in local time; none for a routine that is gone or changed its
	 * cron. Runs at start, on every change and every tick, so a run that failed to book the next one is repaired.
	 */
	async syncSchedules() {
		const now = this.ctx.now();
		const booked = new Set<number>();
		for (const s of this.ctx.schedules.list()) {
			if (s.callback !== "runRoutine") continue;
			if (s.time * 1000 <= now) continue; // firing now; it books the next run itself
			const payload = s.payload as { id: number; cron?: string };
			const r = this.get(payload.id);
			if (!r || s.type !== "scheduled" || payload.cron !== r.cron || booked.has(r.id)) await this.ctx.schedules.cancel(s.id);
			else booked.add(r.id);
		}
		for (const r of this.all()) if (!booked.has(r.id)) await this.book(r, now);
	}

	private async book(r: Routine, after: number) {
		const at = nextRun(r.cron, after);
		if (at === undefined) return console.error(`routine ${r.id}: cron ${r.cron} has no run within a year`);
		await this.ctx.schedules.at(new Date(at), "runRoutine", { id: r.id, cron: r.cron });
	}

	/** `model`: haiku, sonnet or opus for every run of this routine; without it each run takes the agent's model. */
	async save(name: string, agent: string, cron: string, task: string, project?: string, skills: string[] = [], model?: string): Promise<string> {
		if (!isAgentName(agent) || FLEET[agent].role !== "specialist") return `No specialist "${agent}". Specialists: ${specialists().join(", ")}.`;
		const modelId = model ? (MODEL_ALIASES[model.toLowerCase()] ?? model) : undefined;
		if (modelId && !isModelId(modelId)) return `Unknown model "${model}". Use haiku, sonnet or opus.`;
		const bad = cronProblem(cron);
		if (bad) return bad;
		if (project && !this.projects.get(project)) return `No project card "${project}". Save it first with save_project, or leave project out.`;
		const unusable = this.skills.unusable(agent, skills);
		if (unusable) return unusable;
		const clean = cron.trim().split(/\s+/).join(" ");
		this.ctx.sql(
			`INSERT INTO routines (name, agent, cron, task, project, skills, model, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (name) DO UPDATE SET agent = excluded.agent, cron = excluded.cron, task = excluded.task, project = excluded.project, skills = excluded.skills, model = excluded.model`,
			name, agent, clean, task, project ?? null, JSON.stringify(skills), modelId ?? null, this.ctx.now(),
		);
		await this.syncSchedules();
		const id = this.byName(name)!.id;
		const next = nextRun(clean, this.ctx.now());
		return `Routine #${id} "${name}" saved: ${agent} runs it on cron ${clean} (${ZONE_NAME} time)${modelId ? ` on ${modelId}` : ""}; next run ${next ? localStamp(next) : "none within a year"}.`;
	}

	/**
	 * A routine is due: book its next run, then run this one as an ordinary job. The key is the local minute, so a repeated
	 * firing, or the hour that repeats when summer time ends, is a no-op.
	 */
	async run(id: number) {
		const r = this.get(id);
		if (!r) return;
		const now = this.ctx.now();
		await this.book(r, now + 60_000);
		const key = `routine:${id}:${localStamp(now)}`;
		const answer = await this.jobs.create(key, r.agent, routineBrief(r) + this.ratingsLine(id), r.project ?? undefined, JSON.parse(r.skills ?? "[]") as string[], r.model && isModelId(r.model) ? r.model : undefined);
		this.ctx.sql("UPDATE routines SET last_run = ?, last_job = ? WHERE id = ?", this.ctx.now(), this.jobs.byKey(key)?.id ?? null, id);
		console.log(`routine ${id}: ${answer}`);
	}

	/** The operator's ratings of a routine's recent runs, for the brief of its next run. */
	ratingsLine(routineId: number): string {
		const rated = this.ctx.sql<JobRow>("SELECT * FROM jobs WHERE key LIKE ? AND rating IS NOT NULL ORDER BY id DESC LIMIT 6", `routine:${routineId}:%`);
		if (!rated.length) return "";
		return `\n\nThe operator rated recent runs of this routine: ${rated.map((j) => `${j.rating === "up" ? "👍" : "👎"} #${j.id} "${j.title ?? ""}"`).join("; ")}. Do more of what they liked and less of what they did not.`;
	}

	list(): string {
		const rows = this.all();
		if (!rows.length) return "No routines yet.";
		return rows
			.map((r) => `🔁 #${r.id} ${r.name} · ${r.agent}${r.model ? ` · ${r.model.replace("claude-", "")}` : ""} · ${r.cron} ${ZONE_NAME}, next ${((n) => (n ? localStamp(n).slice(5) : "never"))(nextRun(r.cron, this.ctx.now()))}${r.project ? ` [${r.project}]` : ""}${r.last_job ? ` · last job #${r.last_job}` : ""}\n   ${r.task.split("\n")[0]!.slice(0, 120)}`)
			.join("\n");
	}

	/** A new time for a routine, in place: its brief, agent, model, skills, project and history stay as they are. */
	async move(id: number, cron: string): Promise<string> {
		const r = this.get(id);
		if (!r) return `No routine #${id}.`;
		const bad = cronProblem(cron);
		if (bad) return bad;
		const clean = cron.trim().split(/\s+/).join(" ");
		this.ctx.sql("UPDATE routines SET cron = ? WHERE id = ?", clean, id);
		await this.syncSchedules();
		const next = nextRun(clean, this.ctx.now());
		return `Routine #${id} "${r.name}" moved from ${r.cron} to ${clean} (${ZONE_NAME} time); next run ${next ? localStamp(next) : "none within a year"}. Its brief is unchanged.`;
	}

	async cancel(id: number): Promise<string> {
		const r = this.get(id);
		if (!r) return `No routine #${id}.`;
		this.ctx.sql("DELETE FROM routines WHERE id = ?", id);
		await this.syncSchedules();
		return `Routine #${id} "${r.name}" deleted.`;
	}

	/** Two failed runs in a row, for the briefing's health lines. */
	failingTwice(): Routine[] {
		return this.all().filter((r) => {
			const last = this.ctx.sql<JobRow>("SELECT * FROM jobs WHERE key LIKE ? AND status IN ('done', 'failed') ORDER BY id DESC LIMIT 2", `routine:${r.id}:%`);
			return last.length === 2 && last.every((j) => j.status === "failed");
		});
	}
}
