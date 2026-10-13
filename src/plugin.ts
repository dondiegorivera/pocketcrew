// What a plugin may add to the fleet, and nothing more (docs/plugin-design.html). A plugin is a folder under plugins/
// with this manifest, its role files, skills, its section of the crew skill and optional code; the build compiles in
// the plugins pocketcrew.config.ts enables (scripts/bundle-plugins.mjs → src/plugins.gen.ts), and core merges them into
// its registries. Rules for plugin code: the manifest is data; kits load lazily; nothing uses core's registries while
// modules are still loading (only inside functions), so core and plugins may import each other.
import type { Extension } from "@earendil-works/pi-durable";
import type { AgentSpec } from "./fleet.ts";
import type { McpServerSpec } from "./mcp.ts";
import type { RepoView } from "./repo-views.ts";
import type { ToolEntry } from "./tools.ts";
import type { ToolHost } from "./toolkits.ts";
import type { Ctx, Kv } from "./director/context.ts";
import type { Buttons } from "./director/buttons.ts";
import type { Commands } from "./director/commands.ts";
import type { Digests } from "./director/digests.ts";
import type { Fleet } from "./director/fleet.ts";
import type { Jobs } from "./director/jobs.ts";
import type { Onboarding } from "./director/onboarding.ts";
import type { Reactions } from "./director/reactions.ts";
import type { Reminders } from "./director/reminders.ts";
import type { Routines } from "./director/routines.ts";
import type { Skills } from "./director/skills.ts";
import type { Spend } from "./director/spend.ts";
import type { SentStore } from "./reactions.ts";

export type { ToolEntry };
/** Builds a kit's tools for one agent; may load its code lazily. */
export type KitFactory = (host: ToolHost, spec: AgentSpec) => Extension | Promise<Extension>;

/** What a plugin's Director part gets: core's services, through their extension points. */
export type PluginHost = {
	ctx: Ctx;
	kv: Kv;
	sent: SentStore;
	spend: Spend;
	jobs: Jobs;
	routines: Routines;
	skills: Skills;
	fleet: Fleet;
	buttons: Buttons;
	commands: Commands;
	digests: Digests;
	reminders: Reminders;
	reactions: Reactions;
	/** /start's checklist: `steps.push(...)` adds a plugin's setup steps, `action(name, fn)` a step's button (`o:<name>`). */
	onboarding: Onboarding;
	/** Another enabled plugin's Director part, by plugin name (undefined when that plugin is off). */
	plugin<T = unknown>(name: string): T | undefined;
};

/** One step the home server's sync runs (scripts/sync.mjs): a module whose default export is an async function. */
export type ServerStep = { file: string; every: "minute" | "quarter" };

export type Plugin<D = unknown> = {
	name: string;
	/** One line: what the plugin is for. */
	about: string;
	/** Other plugins it builds on (their tools or agents); the build refuses it without them. */
	requires?: string[];
	/** Specialists it adds; each has roles/<agent>.md beside the manifest. */
	agents?: Record<string, AgentSpec>;
	tools?: Record<string, ToolEntry>;
	kits?: Record<string, KitFactory>;
	mcp?: Record<string, McpServerSpec>;
	repoViews?: Record<string, RepoView>;
	/** Its Director features: called once when the Director builds its services; returns what rpc and tick get. */
	director?: (host: PluginHost) => D;
	/** Called every 15 minutes with what `director` returned. */
	tick?: (d: D) => Promise<unknown>;
	/** What the home server calls on the Worker (POST /sync/plugin/<name>/<method>, token-checked by core). */
	rpc?: Record<string, (d: D, args: unknown) => Promise<unknown> | unknown>;
	server?: ServerStep[];
	/** Lines for /help. */
	help?: string[];
	/** What the operator provides: secrets (by name) and Google areas. */
	needs?: { secrets?: string[]; google?: ("gmail" | "calendar" | "docs")[] };
};

export const definePlugin = <D>(p: Plugin<D>): Plugin<D> => p;
