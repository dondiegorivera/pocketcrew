#!/usr/bin/env node
// The server's side of the fleet's git: pulls from the Worker (sync-export.ts) and commits, so the cloud never holds git
// credentials. Every push goes to a bare repo, whose hook mirrors it to GitHub.
//   - Library → <name>-research: one Markdown file per filed report, INDEX.md, and published pages under pages/.
//     One way: the library in Cloudflare is what agents search; the repo is the archive to read, grep and keep.
//   - Private archive → <name>-private (server only, never mirrored): reports of the agents that work on private
//     data, private pages, and the fleet's state (projects, routines, wishes, jobs, the Lead's notes, spend by day),
//     so nothing the fleet made lives only inside Durable Objects.
//   - Skills saved or installed in chat → the code repo: skills/<skill>/ on main, with src/skills.gen.ts regenerated, in its
//     own clone (~/<name>-sync). The next deploy bundles them and the Director drops its copies.
//   - Git feed (src/git-feed.ts): new commits of the followed repos, read-only, with secret-like content scrubbed,
//     for the Ops agent's reports on what changed.
//   - Plugins' steps: each enabled plugin's `server` steps (plugins/<name>/server/), such as /sales answers applied in
//     the domain pipeline.
//   - Health: every full run tells the Director its problems (none: all well); the morning briefing shows them.
//   - Repo views (src/repo-views.ts): agents' queued writes are applied one by one in the repo's working copy
//     (~/<repo>), checked with the view's own scripts and committed, or reverted and reported; then the view is
//     uploaded again, redacted, whenever the repo or the view's definition changed.
//
// The steps live in scripts/sync/, one file each; this runs them.
//
// Usage: node scripts/sync.mjs [research repo dir]   (cron runs it every 15 minutes; see scripts/library-setup.sh)
//        node scripts/sync.mjs --minute   only the repo views marked everyMinute and the plugins' minute steps (cron runs it
//                                         every minute, under the same lock, so it skips while the full run goes)
//        node scripts/sync.mjs --views a,b   the same with the named views (the older form)
// Reads the export token from ~/.config/<name>/library-export-token. Never prints it.
import { archives, syncArchive } from "./sync/archives.mjs";
import { syncGit } from "./sync/git.mjs";
import { reportHealth } from "./sync/health.mjs";
import { syncRepos } from "./sync/repos.mjs";
import { join } from "node:path";
import { plugins } from "../src/plugins.gen.ts";
import { REPO_VIEWS } from "../src/repo-views.ts";
import { syncSkills } from "./sync/skills.mjs";

if (process.argv[2]?.startsWith("-") && !["--minute", "--views"].includes(process.argv[2])) {
	console.error("usage: node scripts/sync.mjs [research repo dir] | --minute | --views a,b");
	process.exit(2);
}
const VIEWS_ONLY =
	process.argv[2] === "--minute"
		? Object.entries(REPO_VIEWS).filter(([, v]) => v.everyMinute).map(([name]) => name)
		: process.argv[2] === "--views"
			? (process.argv[3] ?? "").split(",").filter(Boolean)
			: undefined;

/** The enabled plugins' server steps (their manifests' `server`): every minute, or only in the full run. */
const pluginSteps = (minuteRun) =>
	plugins().flatMap((p) =>
		(p.server ?? [])
			.filter((s) => !minuteRun || s.every === "minute")
			.map((s) => [`${p.name} ${s.file}`, async () => (await import(join(import.meta.dirname, "..", "plugins", p.name, s.file))).default()]),
	);

// Each part on its own: one failing (a bad skill, a network blip) must not hold up the others.
const steps = VIEWS_ONLY
	? [["repos", () => syncRepos(VIEWS_ONLY)], ...pluginSteps(true)]
	: [["skills", syncSkills], ...archives(process.argv[2]).map((a) => [a.name, () => syncArchive(a)]), ["repos", () => syncRepos()], ...pluginSteps(false), ["git", syncGit]];
let failed = false;
for (const [name, step] of steps) {
	try {
		await step();
	} catch (err) {
		failed = true;
		console.error(`${new Date().toISOString()} ${name} sync failed: ${err instanceof Error ? err.message : err}`);
	}
}
if (!VIEWS_ONLY) await reportHealth();
process.exit(failed ? 1 : 0);
