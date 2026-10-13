// The Director's services, built and wired in one place: which feature owns which command, button prefix, finished-job
// kind, briefing line and typed-text interceptor. The Durable Object (../director.ts) builds this over the platform;
// the tests (test-kit.ts) over fakes.
import { Onboarding } from "./onboarding.ts";
import { type AgentName, FLEET, LEAD, specialists } from "../fleet.ts";
import { SentStore } from "../reactions.ts";
import type { Skill } from "../skills.ts";
import { parseWish } from "../wishes.ts";
import { Buttons } from "./buttons.ts";
import { type CommandHandler, Commands } from "./commands.ts";
import { type Ctx, general, Kv } from "./context.ts";
import { Digests } from "./digests.ts";
import { Fleet } from "./fleet.ts";
import { Jobs } from "./jobs.ts";
import { Projects } from "./projects.ts";
import { Reactions } from "./reactions.ts";
import { Reminders } from "./reminders.ts";
import { Routines } from "./routines.ts";
import { Skills } from "./skills.ts";
import { Spend } from "./spend.ts";
import { Wishes } from "./wishes.ts";
import type { Plugin, PluginHost } from "../plugin.ts";

export type Services = ReturnType<typeof buildServices>;

export function buildServices(ctx: Ctx, bundledSkills: readonly Skill[], plugins: readonly Plugin<any>[] = []) {
	const kv = new Kv(ctx.sql);
	const sent = new SentStore(ctx.sql);
	const spend = new Spend(ctx);
	const skills = new Skills(ctx, bundledSkills);
	const projects = new Projects(ctx);
	const fleet = new Fleet(ctx, spend);
	const jobs = new Jobs(ctx, spend, skills, projects, sent, (a) => fleet.threadOf(a), (a) => fleet.modelOf(a));
	fleet.jobs = jobs;
	const buttons = new Buttons(ctx);
	const reminders = new Reminders(ctx);
	const wishes = new Wishes(ctx, jobs, spend, projects);
	const routines = new Routines(ctx, jobs, projects, skills);
	const digests = new Digests(ctx, jobs, routines, spend, buttons);
	const reactions = new Reactions(ctx, sent, jobs, reminders);
	const commands = new Commands(ctx, fleet);

	const say = (text: string) => general(ctx, text);
	const c = (name: string, run: CommandHandler) => commands.register(name, run);
	c("setup", () => fleet.setup());
	c("status", async () => say(await fleet.statusText(Object.keys(FLEET) as AgentName[])));
	c("jobs", async () => say(jobs.list()));
	c("today", async () => say(digests.today()));
	c("cancel", async (arg) => {
		const id = Number(arg.replace(/^#/, ""));
		return say(Number.isInteger(id) && id > 0 ? await jobs.cancel(id) : "Usage: /cancel <job number>");
	});
	c("budget", async (arg) => {
		if (!/^lift( all| off)?$/.test(arg)) return say(spend.text(wishes.store.waiting()));
		const text = spend.lift(arg);
		await jobs.startQueued();
		return say(text);
	});
	c("projects", async () => say(projects.list()));
	c("wish", async (arg, update) => {
		const w = parseWish(arg, specialists());
		if (!w) return say(`Usage: /wish [agent] [haiku|sonnet|opus] <task>. Without an agent it goes to research; without a model it runs on the agent's. Specialists: ${specialists().join(", ")}.`);
		return say(await wishes.add(`chat:${update.update_id}`, w.agent, w.task, undefined, w.model));
	});
	c("wishes", async (arg) => {
		const drop = /^(drop|cancel|delete)\s+#?(\d+)$/.exec(arg);
		return say(drop ? wishes.drop(Number(drop[2])) : wishes.list());
	});
	c("skills", (arg) => skills.command(arg));
	c("routines", async (arg) => {
		const stop = /^(stop|cancel|delete)\s+#?(\d+)$/.exec(arg);
		const move = /^(move|reschedule)\s+#?(\d+)\s+(.+)$/.exec(arg);
		return say(stop ? await routines.cancel(Number(stop[2])) : move ? await routines.move(Number(move[2]), move[3]!) : routines.list());
	});
	c("library", async (arg) => say(await ctx.library().search(arg)));
	c("notes", async () => say(await (await ctx.agent(LEAD)).notesText()));
	c("trace", async (arg) => {
		const names = fleet.targets(arg || LEAD);
		if (typeof names === "string") return say(names);
		if (names.length > 1) return say("Trace one agent at a time.");
		return say(await (await ctx.agent(names[0]!)).trace());
	});
	c("mcp", async () => {
		const using = (Object.keys(FLEET) as AgentName[]).filter((n) => FLEET[n].mcp.length);
		if (!using.length) return say("No agent uses an MCP server. Add one in src/mcp.ts and to an agent's mcp list in fleet.ts.");
		const parts = await Promise.all(using.map(async (n) => `${n}:\n${await (await ctx.agent(n)).mcpText()}`));
		return say(parts.join("\n\n"));
	});
	c("model", async (arg) => say(await fleet.model(arg)));
	c("credit", async (arg) => say(spend.setCredit(arg, wishes.store.waiting())));
	for (const verb of ["stop", "pause", "resume", "reset"] as const) c(verb, async (arg) => say(await fleet.control(verb, arg)));

	// Each enabled plugin's Director part, in config order, over the same services (docs/plugin-design.html).
	const parts = new Map<string, unknown>();
	const onboarding = new Onboarding(ctx, fleet, spend, routines, digests, buttons, commands);
	const host: PluginHost = { ctx, kv, sent, spend, jobs, routines, skills, fleet, buttons, commands, digests, reminders, reactions, onboarding, plugin: <T>(name: string) => parts.get(name) as T | undefined };
	for (const p of plugins) if (p.director) parts.set(p.name, p.director(host));
	const plugin = {
		/** Every 15 minutes: each plugin's tick. */
		tick: async () => {
			for (const p of plugins) if (p.tick && parts.has(p.name)) await p.tick(parts.get(p.name)).catch((err: unknown) => console.error(`${p.name} tick failed:`, err));
		},
		/** The home server's call into a plugin (POST /sync/plugin/<name>/<method>). */
		rpc: async (name: string, method: string, args: unknown) => {
			const p = plugins.find((x) => x.name === name);
			const fn = p?.rpc?.[method];
			if (!p || !fn) throw new Error(`no plugin method ${name}.${method}`);
			return fn(parts.get(name), args);
		},
		part: <T>(name: string) => parts.get(name) as T | undefined,
	};

	return { kv, sent, spend, skills, projects, fleet, jobs, buttons, reminders, wishes, routines, digests, reactions, commands, onboarding, plugin };
}
