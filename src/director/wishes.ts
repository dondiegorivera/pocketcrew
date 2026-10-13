// The wishlist: one-off jobs for "some time", started one at a time on credit quiet days left unspent (budget.ts).
import { isModelId, MODEL_ALIASES } from "../anthropic.ts";
import { paceLine, spareForWishes } from "../budget.ts";
import { FLEET, isAgentName, specialists } from "../fleet.ts";
import { wishBrief, wishJobKey, WishStore } from "../wishes.ts";
import { type Ctx, general, usd } from "./context.ts";
import type { Jobs } from "./jobs.ts";
import type { Projects } from "./projects.ts";
import type { Spend } from "./spend.ts";

export class Wishes {
	readonly store: WishStore;
	private readonly ctx: Ctx;
	private readonly jobs: Jobs;
	private readonly spend: Spend;
	private readonly projects: Projects;
	constructor(
		ctx: Ctx,
		jobs: Jobs,
		spend: Spend,
		projects: Projects,
	) {
		this.ctx = ctx;
		this.jobs = jobs;
		this.spend = spend;
		this.projects = projects;
		this.store = new WishStore(ctx.sql);
	}

	/** `model`: haiku, sonnet, opus or a model id, for this wish only; without it the wish takes the agent's model. */
	async add(key: string, agent: string, task: string, project?: string, model?: string): Promise<string> {
		if (!isAgentName(agent) || FLEET[agent].role !== "specialist") return `No specialist "${agent}". Specialists: ${specialists().join(", ")}.`;
		if (project && !this.projects.get(project)) return `No project card "${project}". Save it first with save_project, or leave project out.`;
		const modelId = model ? (MODEL_ALIASES[model.toLowerCase()] ?? model) : undefined;
		if (modelId && !isModelId(modelId)) return `Unknown model "${model}". Use haiku, sonnet or opus.`;
		const id = this.store.add(key, agent, task, project, modelId);
		await this.startNext();
		const started = this.jobs.byKey(wishJobKey(id))?.id;
		return started ? `Wish #${id} started at once as job #${started} with ${agent}: credit is spare.` : `Wish #${id} is on the wishlist for ${agent}. ${paceLine(this.spend.allowanceNow())}`;
	}
	list(): string {
		return `${this.store.text()}\n\n${paceLine(this.spend.allowanceNow())}`;
	}
	drop(id: number): string {
		return this.store.drop(id);
	}

	/** Starts the oldest wish when credit is spare and no other wish is queued or running, so they run one at a time. */
	async startNext() {
		const a = this.spend.allowanceNow();
		if (!spareForWishes(a)) return;
		if (this.jobs.withKey("wish:", ["queued", "running"]).length) return;
		const w = this.store.next();
		if (!w || this.spend.check(w.agent, true)) return;
		const answer = await this.jobs.create(wishJobKey(w.id), w.agent, wishBrief(w), w.project ?? undefined, [], w.model && isModelId(w.model) ? w.model : undefined);
		const job = this.jobs.byKey(wishJobKey(w.id))?.id;
		if (job === undefined) {
			this.store.drop(w.id);
			return void (await general(this.ctx, `🌱 Wish #${w.id} could not start and was dropped: ${answer}`));
		}
		this.store.started(w.id, job);
		await general(this.ctx, `🌱 ${usd(a.unspentUsd)} unspent beyond the even pace: wish #${w.id} started as job #${job} with ${w.agent}${w.model ? ` on ${w.model.replace("claude-", "")}` : ""}.`);
	}
}
