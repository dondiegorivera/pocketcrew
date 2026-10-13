// Repo views: which files of a git repo on the server an agent may read, with what left out, and which it may write.
// The server's sync (scripts/sync.mjs) uploads each view and commits the agents' writes; agents never get git or a
// token. Pure data and functions, shared by the Worker and the sync script (plain node).
import { lazy } from "./lazy.ts";
import { plugins } from "./plugins.gen.ts";
import type { Risk } from "./tools.ts";

export type RepoView = {
	/** The repo's directory name under the server's home (its working copy) and in the git root (pocketcrew.config.ts gitRoot). */
	repo: string;
	/** What the view's files expose, like a tool's risks (tools.ts). */
	risks: Risk[];
	/** Files in the view, as globs: `*` within a path segment, `**` across segments. */
	include: string[];
	exclude?: string[];
	/** Per path (a glob), how the file is cut down before upload. */
	redact?: Record<string, (text: string) => string>;
	/** Files agents may append to or replace. Never the files that drive real-world actions. */
	writable?: string[];
	/** Run in the working copy after applying writes; a failure discards them. */
	check?: string[];
	/** One line for the agents: what this view is. */
	about: string;
	/** Synced every minute (scripts/sync.mjs --minute), for views a person edits too; otherwise every 15 minutes. */
	everyMinute?: boolean;
};

export const CORE_VIEWS = {
} satisfies Record<string, RepoView>;

/** Core's views and every enabled plugin's (plugin.ts). */
export const REPO_VIEWS: Record<string, RepoView> = lazy(() => Object.assign({}, CORE_VIEWS, ...plugins().map((p) => p.repoViews ?? {})));

export type ViewName = string;
export const isViewName = (name: string): name is ViewName => Object.hasOwn(REPO_VIEWS, name);
export const viewOf = (name: ViewName): RepoView => REPO_VIEWS[name]!;

/** Glob match: `*` stays within a path segment, `**` crosses them; `**` followed by a slash also matches no folder, so it covers top-level files. */
export function matches(path: string, glob: string): boolean {
	const re = glob
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*\//g, "\u0001")
		.replace(/\*\*/g, "\u0000")
		.replace(/\*/g, "[^/]*")
		.replace(/\u0001/g, "(?:.*/)?")
		.replace(/\u0000/g, ".*");
	return new RegExp(`^${re}$`).test(path);
}
export const inView = (v: RepoView, path: string) => v.include.some((g) => matches(path, g)) && !(v.exclude ?? []).some((g) => matches(path, g));
export const writableIn = (v: RepoView, path: string) => !path.split("/").includes("..") && (v.writable ?? []).some((g) => matches(path, g));


/** The view's content of one file, or undefined when the file is not in the view. */
export function viewFile(v: RepoView, path: string, text: string): string | undefined {
	if (!inView(v, path)) return undefined;
	const rule = Object.entries(v.redact ?? {}).find(([g]) => matches(path, g))?.[1];
	return rule ? rule(text) : text;
}
