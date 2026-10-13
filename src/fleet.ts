// The fleet: one entry = one standing agent with its own Durable Object and (except the Lead) its own Telegram topic.
// This is the wiring (model, tools, budget); what the agent is for and how it behaves is its role file, roles/<name>.md.
// The safety checks on it are in safety.ts, the instructions every agent gets in instructions.ts.
// Adding an agent is an entry here plus its role file, then a push; `/setup` in the group's General topic creates its topic.
import { CONFIG } from "./config.ts";
import { lazy } from "./lazy.ts";
import { plugins } from "./plugins.gen.ts";
import type { ModelId } from "./anthropic.ts";
import type { Credit } from "./budget.ts";
import type { McpName } from "./mcp.ts";
import type { ViewName } from "./repo-views.ts";
import type { ToolName } from "./tools.ts";

export type AgentSpec = {
	/** Telegram topic name. */
	title: string;
	/** The Lead lives in General, talks to the operator and dispatches; specialists do the work in their topics. */
	role: "lead" | "specialist";
	/** One line the Lead reads when choosing who gets a job. */
	does: string;
	model: ModelId;
	/** Thinking effort. Never "off": Opus 5.5 rejects disabled thinking. */
	effort: "low" | "medium" | "high";
	/** Tools from tools.ts. The safety rule is checked on what they expose together, MCP servers included. */
	tools: ToolName[];
	/** MCP servers from mcp.ts; only their allow-listed tools are offered. */
	mcp: McpName[];
	/** Repo views from repo-views.ts the agent's repo tools reach. */
	repos?: ViewName[];
	/**
	 * Weight in each day's paced fleet budget: its part is this over the enabled agents' total (`shareOf`), so turning a
	 * plugin off gives the others its part. An agent may use up to twice its part on quiet days.
	 */
	share: number;
	/** Jobs this agent runs at once; above 1, each job gets its own worker Durable Object. */
	parallelJobs: number;
	/** Searches one job or one chat turn may run. */
	searchesPerJob: number;
};


export const CORE_FLEET = {
	lead: {
		title: "Lead",
		role: "lead",
		does: "talks with the operator, plans, and hands work to the specialists",
		model: "claude-opus-5-5",
		effort: "low",
		tools: [
			...["dispatch", "jobs", "cancel_job", "save_project", "list_projects", "schedule_routine", "routines", "move_routine", "cancel_routine"] as const,
			...["add_wish", "wishes", "drop_wish"] as const,
			...["remember", "forget", "read_skill", "save_skill", "install_skill", "delete_skill", "publish_page"] as const,
		],
		mcp: [],
		share: 0.25,
		parallelJobs: 1,
		searchesPerJob: 0,
	},
} satisfies Record<string, AgentSpec>;

/** Core's agents and every enabled plugin's (plugin.ts). The safety checks (safety.ts) run on this. */
export const FLEET: Record<string, AgentSpec> = lazy(() => withOverrides(Object.assign({}, CORE_FLEET, ...plugins().map((p) => p.agents ?? {}))));

/** The owner's per-agent changes (pocketcrew.config.ts `agents`) over the defaults; unknown names are fleetProblems' to report. */
function withOverrides(fleet: Record<string, AgentSpec>): Record<string, AgentSpec> {
	for (const [name, o] of Object.entries(CONFIG.agents)) if (fleet[name]) fleet[name] = { ...fleet[name]!, ...(o as Partial<AgentSpec>) };
	return fleet;
}

/** The credit as the Anthropic Console showed it (pocketcrew.config.ts); `/credit` overrides it at runtime when a new grant arrives. */
export const CREDIT: Credit = CONFIG.credit;

export const LIMITS = {
	/** Held back from the credit so its last cents never become a bill on the card behind it. */
	reserveUsd: 1,
	maxConcurrentJobs: 12,
	/** Routing gets unreliable past about this many specialists under one Lead. */
	maxSpecialistsPerLead: 9,
};

export type AgentName = string;

export const isAgentName = (name: string): name is AgentName => Object.hasOwn(FLEET, name);
/** An agent's part of the day's budget: its share over the enabled agents' total (1 when they add up to 1). */
export const shareOf = (name: string): number => FLEET[name]!.share / Object.values(FLEET).reduce((sum, s) => sum + s.share, 0);

export const specOf = (name: string): AgentSpec => {
	if (!isAgentName(name)) throw new Error(`no agent "${name}" in fleet.ts`);
	return FLEET[name]!;
};
/** The Lead is core's own agent (CORE_FLEET.lead); plugins add specialists only (safety.ts pluginProblems). */
export const LEAD: AgentName = "lead";
/** Every specialist, core's and the enabled plugins'. A function, like every registry read (src/lazy.ts). */
export const specialists = (): AgentName[] => Object.keys(FLEET).filter((n) => FLEET[n]!.role === "specialist");

/** A job worker is named `<agent>~<job id>`; its spec, topic and budget share are its agent's. */
export const baseName = (name: string) => name.split("~")[0]!;
