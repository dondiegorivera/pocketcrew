// Assembles an agent's tools from its fleet.ts entry: the kits that hold its named tools, plus its MCP servers.
// A kit is a pi extension (tools, and maybe prompt sections); this is the one place that knows how each is built.
import type { Extension, ToolRegistration } from "@earendil-works/pi-durable";
import { type AgentSpec } from "./fleet.ts";
import { riskSet } from "./safety.ts";
import { type DirectorApi, leadKit } from "./lead.ts";
import { type LibraryApi, libraryKit } from "./library.ts";
import type { GitApi } from "./git-feed.ts";
import { alertKit } from "./alert.ts";
import { handoverKit } from "./handover.ts";
import { type McpHost, mcpKit } from "./mcp.ts";
import { type NotesStore, notesKit } from "./notes.ts";
import { type PagesApi, pagesKit } from "./pages.ts";
import type { KitFactory } from "./plugin.ts";
import { lazy } from "./lazy.ts";
import { plugins } from "./plugins.gen.ts";
import { type KitName, TOOLS } from "./tools.ts";
import type { GoogleApi } from "./google/connector.ts";
import { type RepoApi, repoKit } from "./repos.ts";
import { type SkillsApi, skillsKit } from "./skills.ts";
import { isSet, secret } from "./secrets.ts";

/** The budget check around web searches: whether one may run, and how many ran. */
export type SearchGuard = {
	/** A reason the search may not run, or undefined to go ahead. */
	refuse(): Promise<string | undefined>;
	record(searches: number): void;
};

/** What the kits need from the agent that runs them. */
export type ToolHost = {
	env: Env;
	/** The agent's fleet name (a job worker's is its agent's). */
	agent: string;
	director(): Promise<DirectorApi & SkillsApi>;
	library(): Promise<LibraryApi & PagesApi>;
	/** Where published pages are served (the reports Worker), and who hears of each one published. */
	siteUrl: string;
	published(url: string): void;
	searchGuard: SearchGuard;
	notes: NotesStore;
	mcp: McpHost;
	google(): Promise<GoogleApi>;
	repos(): Promise<RepoApi & GitApi>;
	/** Posts a label and then a text, as two messages in the agent's topic. */
	copy(label: string, text: string): Promise<void>;
	/** One ⚡ message in the agent's topic, at most once a day; answers why it refused, or undefined when sent. */
	alert(text: string): Promise<string | undefined>;
};

const CORE_KITS: Record<string, KitFactory> = {
	lead: (h) => leadKit(h.director),
	notes: (h) => notesKit(h.notes),
	library: (h) => libraryKit(h.library),
	pages: (h, spec) => {
		const risks = riskSet(spec);
		// Pages built from private data stay private; only agents without a way out may read them back.
		return pagesKit(h.library, h.siteUrl, (url) => h.published(url), { privateAgent: risks.has("private"), readsPrivate: risks.has("private") && !risks.has("egress") });
	},
	skills: (h) => skillsKit(h.director, h.agent),
	repo: (h, spec) => repoKit(h.repos, h.agent, spec.repos ?? []),
	handover: (h) => handoverKit(h.copy),
	alert: (h) => alertKit(h.alert),
};

/** Core's kits and every enabled plugin's (plugin.ts): how each tool's code is built for one agent. */
export const KITS: Record<KitName, KitFactory> = lazy(() => Object.assign({}, CORE_KITS, ...plugins().map((p) => p.kits ?? {})));

/** The extensions to install and the exact tools to offer: a kit's other tools stay installed but unoffered. */
export async function toolsFor(spec: AgentSpec, host: ToolHost): Promise<{ extensions: Extension[]; tools: ToolRegistration[] }> {
	const extensions = await Promise.all([...new Set(spec.tools.map((t) => TOOLS[t]!.kit))].map((kit) => KITS[kit]!(host, spec)));
	const wanted = new Set<string>(spec.tools);
	const tools = extensions.flatMap((e) => (e.tools ?? []) as ToolRegistration[]).filter((t) => wanted.has(t.name));
	if (spec.mcp.length) {
		const mcp = await mcpKit(host.mcp, spec.mcp, host.env);
		extensions.push(mcp.extension);
		tools.push(...mcp.tools);
	}
	return { extensions, tools };
}
