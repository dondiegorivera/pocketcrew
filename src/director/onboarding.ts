// The first run, from the phone: /start shows what is set up and what is not, one line per step, with a button for the
// next one. Core checks the topics, the budget, a first request and a routine, and the optional home server; plugins
// add their own steps (the google plugin: the sign-in). A new instance shows it once by itself, at the first message.
import { LEAD, specialists } from "../fleet.ts";
import type { Button } from "../telegram.ts";
import type { Tap } from "./buttons.ts";
import type { Commands } from "./commands.ts";
import { type Ctx, general, Kv } from "./context.ts";
import type { Digests } from "./digests.ts";
import type { Fleet } from "./fleet.ts";
import type { Routines } from "./routines.ts";
import type { Spend } from "./spend.ts";
import type { Buttons } from "./buttons.ts";

/** One line of the checklist: done, still to do, or optional; a button for it, if one tap can do it. */
export type Step = { state: "done" | "todo" | "optional"; text: string; button?: Button };
export type StepProvider = () => Promise<Step[]> | Step[];
/** What a step's button does when tapped (data `o:<action>`), registered by whoever offers the step. */
export type StepAction = (tap: Tap) => Promise<unknown>;

const MARK = { done: "✅", todo: "▫️", optional: "➖" } as const;

/** The checklist as one message: done steps first in a line each, then what is left, and a button per open step. */
export function checklistText(steps: Step[]): { text: string; buttons: Button[][] } {
	const open = steps.filter((s) => s.state === "todo");
	const head = open.length ? `🧭 Setting up: ${steps.filter((s) => s.state === "done").length} of ${steps.filter((s) => s.state !== "optional").length} done.` : "🧭 All set. /help lists every command.";
	return {
		text: [head, ...steps.map((s) => `${MARK[s.state]} ${s.text}`)].join("\n"),
		buttons: steps.filter((s) => s.state !== "done" && s.button).map((s) => [s.button!]),
	};
}

export class Onboarding {
	readonly steps: StepProvider[] = [];
	private readonly actions = new Map<string, StepAction>();
	private readonly ctx: Ctx;
	private readonly kv: Kv;
	constructor(ctx: Ctx, fleet: Fleet, spend: Spend, routines: Routines, digests: Digests, buttons: Buttons, commands: Commands) {
		this.ctx = ctx;
		this.kv = new Kv(ctx.sql);
		commands.register("start", () => this.show());
		buttons.register("o", (t) => this.tap(t));
		// An instance that already has its topics was set up before this checklist existed: it never shows by itself.
		if (fleet.topicCount() > 0 && !this.kv.get("onboarded")) this.kv.set("onboarded", "1");
		commands.interceptors.push(async () => {
			if (this.kv.get("onboarded")) return false;
			this.kv.set("onboarded", "1");
			await this.show();
			return false; // the message still goes to the Lead
		});

		const ask = (text: string) => async (tap: Tap) => {
			await tap.done("Asked the Lead.");
			await (await ctx.agent(LEAD)).receive(-Math.floor(ctx.now()), text);
		};
		this.action("setup", async (tap) => {
			await tap.done("Creating the topics…");
			await fleet.setup();
			await this.show();
		});
		this.action("try", ask("Introduce the crew to me in one short message: what each specialist can do for me, with one example request each."));
		this.action("routine", ask("Suggest three routines that would suit me from what you know, one line each with when it would run. Save none until I pick one."));
		this.steps.push(() => {
			const need = specialists().length;
			const have = fleet.topicCount();
			const credit = spend.credit();
			const until = Date.parse(credit.expires);
			const asked = this.ctx.sql<{ n: number }>("SELECT COUNT(*) AS n FROM jobs")[0]!.n > 0;
			const sync = digests.state().syncSeen;
			return [
				have >= need
					? { state: "done", text: `Topics: one per agent (${need}).` }
					: { state: "todo", text: `Topics: ${have} of ${need}. The bot must be an admin with "Manage topics".`, button: { text: "Create the topics", data: "o:setup" } },
				credit.usd > 0 && until > this.ctx.now()
					? { state: "done", text: `Budget: $${credit.usd} until ${credit.expires.slice(0, 10)}, paced daily · /budget` }
					: { state: "todo", text: "Budget: send /credit <usd> <YYYY-MM-DD>, the amount the crew may spend and until when." },
				asked
					? { state: "done", text: "A first request: the Lead has handed out work." }
					: { state: "todo", text: "A first request: write to the Lead here, as to an assistant.", button: { text: "Introduce the crew", data: "o:try" } },
				routines.all().length > 0
					? { state: "done", text: "A routine: /routines lists them." }
					: { state: "todo", text: 'A routine: ask "every weekday at 8, …"; results wait for the morning briefing.', button: { text: "Suggest routines", data: "o:routine" } },
				sync > 0
					? { state: "done", text: "Home server: syncing archives and repos." }
					: { state: "optional", text: "Home server (optional): keeps archives in git and deploys on push; see docs/setup.md." },
			];
		});
	}

	/** A step's button; the action name is the button data after "o:". */
	action(name: string, fn: StepAction) {
		if (this.actions.has(name)) throw new Error(`onboarding action ${name} is taken`);
		this.actions.set(name, fn);
	}

	async show() {
		const steps: Step[] = [];
		for (const p of this.steps) steps.push(...(await Promise.resolve(p()).catch((err: unknown) => (console.error("onboarding step failed:", err), []))));
		const { text, buttons } = checklistText(steps);
		await general(this.ctx, text, buttons.length ? { buttons } : undefined);
	}

	private async tap(tap: Tap) {
		const fn = this.actions.get(tap.action);
		if (!fn) return tap.done("That step is gone; /start shows the current ones.");
		await fn(tap);
	}
}
