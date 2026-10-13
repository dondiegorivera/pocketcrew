// Ops: the operator's own projects, read-only. What changed in their git repos (the git feed, stored by core and
// uploaded by the server's sync) and how their websites' traffic moves (Cloudflare's analytics, sites.ts).
import { definePlugin } from "../../src/plugin.ts";
import { isSet, secret } from "../../src/secrets.ts";

export default definePlugin({
	name: "ops",
	about: "Git reports and website traffic for the operator's own projects, read-only.",
	agents: {
		ops: {
			title: "Ops",
			role: "specialist",
			does: "follows the operator's projects: what changed in their git repos (the followed repos in pocketcrew.config.ts) and how their websites' traffic moves, with spikes; read-only",
			model: "claude-haiku-5-5",
			effort: "medium",
			tools: ["git_repos", "git_log", "git_show", "git_branches", "sites_overview", "site_traffic", "site_spikes", "sites_capabilities", "cf_graphql", "publish_page", "read_skill"],
			mcp: [],
			share: 0.04,
			parallelJobs: 1,
			searchesPerJob: 0,
		},
	},
	tools: {
		// The git feed (git-feed.ts): commits and diffs of the operator's own repos, read-only.
		git_repos: { kit: "git", risks: ["private"] },
		git_log: { kit: "git", risks: ["private"] },
		git_show: { kit: "git", risks: ["private"] },
		git_branches: { kit: "git", risks: ["private"] },
		// Website traffic from Cloudflare (sites.ts): counts per day, no referrers or paths.
		sites_overview: { kit: "sites", risks: ["private"] },
		site_traffic: { kit: "sites", risks: ["private"] },
		site_spikes: { kit: "sites", risks: ["private"] },
		sites_capabilities: { kit: "sites", risks: ["private"] },
		cf_graphql: { kit: "sites", risks: ["private", "untrusted"] }, // paths, referrers and user agents are written by strangers
	},
	kits: {
		git: async (h) => (await import("../../src/git-feed.ts")).gitKit(h.repos),
		sites: async (h) =>
			(await import("./sites.ts")).sitesKit(async () => {
				const t = await secret(h.env, "CF_ANALYTICS_TOKEN");
				return isSet(t) ? t : "";
			}),
	},
	director: (host) => host,
	rpc: {
		/** For the developer on the server: whether the analytics token works and what it reaches; never the token. */
		sites: async (host) => (await import("./diag.ts")).sitesDiagnosis(await host.ctx.secret("CF_ANALYTICS_TOKEN")),
	},
	needs: { secrets: ["CF_ANALYTICS_TOKEN"] },
});
