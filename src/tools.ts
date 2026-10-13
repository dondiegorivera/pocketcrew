// Every tool an agent can be given, and what holding it exposes. Pure data, so fleet.ts can check the safety rule
// without loading any tool code: no agent may hold private data, untrusted content and a way out together.
// The implementations live in their kits (lead.ts, notes.ts, web.ts, library.ts), assembled by toolkits.ts.

import { lazy } from "./lazy.ts";
import { plugins } from "./plugins.gen.ts";

/**
 * - private: the operator's own data (notes, later mail, calendar, docs) reaches the model.
 * - untrusted: text written by strangers (web pages, search results, reports built from them) reaches the model.
 * - egress: the model can push text somewhere outside (a URL, a search query, another agent that has the web).
 */
export type Risk = "private" | "untrusted" | "egress";
export type ToolEntry = { kit: string; risks: Risk[] };

export const CORE_TOOLS = {
	dispatch: { kit: "lead", risks: ["egress"] }, // the brief reaches specialists that use the web
	jobs: { kit: "lead", risks: [] },
	cancel_job: { kit: "lead", risks: [] },
	save_project: { kit: "lead", risks: [] },
	list_projects: { kit: "lead", risks: [] },
	schedule_routine: { kit: "lead", risks: ["egress"] }, // a brief that runs on its own later, like dispatch
	routines: { kit: "lead", risks: [] },
	move_routine: { kit: "lead", risks: [] },
	cancel_routine: { kit: "lead", risks: [] },
	add_wish: { kit: "lead", risks: ["egress"] }, // a brief that runs on its own later, like dispatch
	wishes: { kit: "lead", risks: [] },
	drop_wish: { kit: "lead", risks: [] },
	remember: { kit: "notes", risks: ["private"] },
	forget: { kit: "notes", risks: ["private"] },
	library_search: { kit: "library", risks: ["untrusted"] },
	library_read: { kit: "library", risks: ["untrusted"] },
	// Pages reach only the operator: the site sits behind Access and blocks scripts and outside loads (pages.ts).
	publish_page: { kit: "pages", risks: [] },
	read_page: { kit: "pages", risks: ["untrusted"] }, // pages are built from web content
	// Skills are instructions: the operator's (repo, chat) or an agent's, announced in General with undo. Ones from outside
	// text (a URL, an agent that reads the web) are kept from the Lead by the Director.
	read_skill: { kit: "skills", risks: [] },
	save_skill: { kit: "skills", risks: [] },
	delete_skill: { kit: "skills", risks: [] },
	// The Director fetches the URL the Lead names (a way out); the Lead never reads what comes back.
	install_skill: { kit: "skills", risks: ["egress"] },
	// Text for the operator to paste elsewhere (handover.ts): it reaches only the operator.
	send_copy: { kit: "handover", risks: [] },
	alert_operator: { kit: "alert", risks: [] }, // one message to the operator, at most daily
	// Repo views (repos.ts): what a view exposes is the view's own risks (repo-views.ts), counted with the agent's views.
	repo_files: { kit: "repo", risks: [] },
	repo_read: { kit: "repo", risks: [] },
	repo_grep: { kit: "repo", risks: [] },
	repo_write: { kit: "repo", risks: [] },
} satisfies Record<string, ToolEntry>;

/** Core's tools and every enabled plugin's (plugin.ts): the one catalog the safety checks read. */
export const TOOLS: Record<string, ToolEntry> = lazy(() => Object.assign({}, CORE_TOOLS, ...plugins().map((p) => p.tools ?? {})));

export type ToolName = string;
export type KitName = string;

export const isToolName = (name: string): name is ToolName => Object.hasOwn(TOOLS, name);

export const risksOf = (tools: readonly ToolName[]): Set<Risk> => new Set(tools.flatMap((t) => TOOLS[t].risks));
