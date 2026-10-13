// The safety rules, checked on the fleet's wiring (fleet.ts) and its tools' declared risks (tools.ts, mcp.ts,
// repo-views.ts): no agent holds private data, strangers' content and a way out together; private results stay with
// the operator; chained jobs pass only what the rules allow; roles match the tools. fleetProblems() and roleProblems()
// run as tests, so a change that breaks them never deploys.
import { CONFIG } from "./config.ts";
import { PRICES } from "./anthropic.ts";
import { type AgentSpec, baseName, FLEET, LIMITS, specialists, specOf } from "./fleet.ts";
import { type McpName, mcpRisks } from "./mcp.ts";
import { REPO_VIEWS } from "./repo-views.ts";
import { parseRole } from "./role-format.ts";
import { ROLES } from "./roles.gen.ts";
import { type Risk, risksOf, TOOLS, type ToolName } from "./tools.ts";
import type { Plugin } from "./plugin.ts";

/**
 * Whether a specialist's job results may go back to the Lead. Not when the specialist reads the operator's private data
 * and text written by others (mail, invites): the Lead dispatches to agents that use the web, so a planted instruction
 * in a mail could carry private data out through it. Such results go to the operator only, in the specialist's topic.
 */
export const reportsToLead = (name: string): boolean => {
	const risks = riskSet(specOf(baseName(name)));
	return !(risks.has("private") && risks.has("untrusted"));
};

/** Everything an agent's entry exposes: its tools, its MCP servers and its repo views. */
export const riskSet = (s: AgentSpec): Set<Risk> => new Set([...risksOf(s.tools), ...mcpRisks(s.mcp), ...(s.repos ?? []).flatMap((v) => REPO_VIEWS[v].risks)]);

/**
 * Whether a specialist's reports go into the research library. Not when it holds private data: the library is read by
 * agents that use the web and copied to the archive repo, so mail, calendar and documents never enter it.
 */
export const filesInLibrary = (name: string): boolean => !riskSet(specOf(baseName(name))).has("private");

/** Inputs an earlier job's result carries into a job that builds on it: what its agent read (private data, strangers' text). */
const carried = (agent: string): Risk[] => [...new Set<Risk>([...riskSet(specOf(baseName(agent)))].filter((r) => r !== "egress").concat("untrusted"))];

/**
 * Why `target` may not receive the full results of jobs done by `sources`, or undefined. A private result goes only to
 * agents that keep their own results private and have no way out; any result counts as strangers' text; and the target
 * with what it receives must not hold private data, strangers' text and a way out together.
 */
export function inputProblem(target: string, sources: readonly string[]): string | undefined {
	for (const src of sources) {
		if (inputProblemOne(target, src))
			return `${src}'s results hold private data or strangers' text that ${target} must not get. They may go to: ${passesTo(src).join(", ") || "no one"}.`;
	}
	return undefined;
}

/** The specialists a job of `source` may be passed to (dispatch inputs). */
export const passesTo = (source: string): string[] => specialists().filter((n) => !inputProblemOne(n, source));
const inputProblemOne = (target: string, source: string) => {
	const t = riskSet(specOf(target));
	const c = carried(source);
	const risks = new Set([...t, ...c]);
	return (c.includes("private") && (t.has("egress") || filesInLibrary(target))) || (risks.has("private") && risks.has("untrusted") && risks.has("egress"));
};

/**
 * Role files against the fleet: each agent has one in the role shape, and no role names a tool its agent does not have
 * (tool names with an underscore, and MCP tools by server), so a role never promises what the code does not give.
 */
export function roleProblems(fleet: Record<string, AgentSpec> = FLEET, roles: Record<string, string> = ROLES): string[] {
	const problems: string[] = [];
	const toolNames = Object.keys(TOOLS).filter((t) => t.includes("_"));
	for (const [name, s] of Object.entries(fleet)) {
		const text = roles[name];
		if (!text) {
			problems.push(`${name}: no role file roles/${name}.md`);
			continue;
		}
		const parsed = parseRole(text);
		if (typeof parsed === "string") problems.push(`${name}: ${parsed}`);
		const has = new Set<string>(s.tools);
		for (const t of toolNames) if (new RegExp(`\\b${t}\\b`).test(text) && !has.has(t as ToolName)) problems.push(`${name}: its role names ${t}, which it does not have`);
		for (const m of text.matchAll(/\bmcp_([a-z]+)_/g)) if (!s.mcp.includes(m[1] as McpName)) problems.push(`${name}: its role names MCP server ${m[1]}, which it does not have`);
	}
	for (const name of Object.keys(roles)) if (!Object.hasOwn(fleet, name)) problems.push(`roles/${name}.md: no such agent in the fleet`);
	return problems;
}

/** Config mistakes that would break the plan's safety or budget rules; empty when the fleet is sound. */
export function fleetProblems(fleet: Record<string, AgentSpec> = FLEET, overrides: Record<string, unknown> = CONFIG.agents): string[] {
	const problems: string[] = [];
	for (const name of Object.keys(overrides)) if (!Object.hasOwn(fleet, name)) problems.push(`pocketcrew.config.ts changes agent "${name}", which no enabled plugin adds`);
	const entries = Object.entries(fleet);
	const leads = entries.filter(([, s]) => s.role === "lead");
	if (leads.length !== 1) problems.push(`exactly one lead needed, found ${leads.length}`);
	if (entries.length - leads.length > LIMITS.maxSpecialistsPerLead) problems.push("more specialists than one Lead routes well");
	for (const [name, s] of entries) {
		if (!Object.hasOwn(PRICES, s.model)) problems.push(`${name}: unknown model ${s.model}`);
		const risks = riskSet(s);
		if (risks.has("private") && risks.has("untrusted") && risks.has("egress"))
			problems.push(`${name}: private data, untrusted content and a way out together; split the work across agents`);
		if (s.role === "lead" && risks.has("untrusted")) problems.push(`${name}: the Lead reads no web or third-party content; it only routes`);
		if (s.role === "lead" && !s.tools.includes("dispatch")) problems.push(`${name}: the Lead needs dispatch`);
		if (!(s.share > 0)) problems.push(`${name}: a budget share must be above 0`);
		if (s.parallelJobs < 1) problems.push(`${name}: parallelJobs must be at least 1`);
		if (name.includes("~")) problems.push(`${name}: "~" is reserved for job workers`);
		const usesRepo = s.tools.some((t) => t.startsWith("repo_"));
		if (usesRepo !== Boolean(s.repos?.length)) problems.push(`${name}: repo tools and repo views go together`);
	}
	return problems;
}

/** What core itself declares, for checking plugins against it (fleet.ts, tools.ts, mcp.ts, repo-views.ts, toolkits.ts). */
export type CoreNames = { agents: string[]; tools: string[]; kits: string[]; mcp: string[]; views: string[] };

/**
 * Plugin mistakes the build refuses (docs/plugin-design.html): a bad or repeated name, anything a plugin adds that core
 * or another plugin already has, a tool without risks, a tool whose kit no one builds, an agent naming a tool, MCP server
 * or repo view that does not exist. Commands and button prefixes are refused when the Director registers them.
 */
export function pluginProblems(plugins: readonly Plugin<any>[], core: CoreNames): string[] {
	const problems: string[] = [];
	const seen: Record<keyof CoreNames, Map<string, string>> = {
		agents: new Map(core.agents.map((n) => [n, "core"])),
		tools: new Map(core.tools.map((n) => [n, "core"])),
		kits: new Map(core.kits.map((n) => [n, "core"])),
		mcp: new Map(core.mcp.map((n) => [n, "core"])),
		views: new Map(core.views.map((n) => [n, "core"])),
	};
	const names = new Set<string>();
	for (const p of plugins) {
		if (!/^[a-z][a-z0-9-]*$/.test(p.name)) problems.push(`plugin "${p.name}": a name is lowercase letters, digits and dashes`);
		if (names.has(p.name)) problems.push(`plugin "${p.name}" is enabled twice`);
		names.add(p.name);
		const add = (kind: keyof CoreNames, keys: string[]) => {
			for (const k of keys) {
				const owner = seen[kind].get(k);
				if (owner) problems.push(`plugin "${p.name}": ${kind.slice(0, -1)} "${k}" is already ${owner === "core" ? "core's" : `plugin "${owner}"'s`}`);
				else seen[kind].set(k, p.name);
			}
		};
		add("agents", Object.keys(p.agents ?? {}));
		add("tools", Object.keys(p.tools ?? {}));
		add("kits", Object.keys(p.kits ?? {}));
		add("mcp", Object.keys(p.mcp ?? {}));
		add("views", Object.keys(p.repoViews ?? {}));
		for (const [t, e] of Object.entries(p.tools ?? {})) if (!Array.isArray(e.risks)) problems.push(`plugin "${p.name}": tool "${t}" declares no risks`);
	}
	for (const p of plugins) {
		for (const [t, e] of Object.entries(p.tools ?? {})) if (!seen.kits.has(e.kit)) problems.push(`plugin "${p.name}": tool "${t}" is built by kit "${e.kit}", which no one has`);
		for (const [a, spec] of Object.entries(p.agents ?? {})) {
			for (const t of spec.tools) if (!seen.tools.has(t)) problems.push(`plugin "${p.name}": agent "${a}" names tool "${t}", which no one has`);
			for (const m of spec.mcp) if (!seen.mcp.has(m)) problems.push(`plugin "${p.name}": agent "${a}" names MCP server "${m}", which no one has`);
			for (const v of spec.repos ?? []) if (!seen.views.has(v)) problems.push(`plugin "${p.name}": agent "${a}" names repo view "${v}", which no one has`);
			if (spec.role !== "specialist") problems.push(`plugin "${p.name}": agent "${a}" must be a specialist; the Lead is core's`);
		}
	}
	return problems;
}
