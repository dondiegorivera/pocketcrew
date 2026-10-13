// The web: Research (desk research and report pages) and Radar (new models, datasets and techniques for the operator's
// projects), web search and fetch, and the read-only research MCP servers. Agents here hold no private data.
import { definePlugin } from "../../src/plugin.ts";
import { secret } from "../../src/secrets.ts";

export default definePlugin({
	name: "web",
	about: "Research and Radar: web search and fetch, report pages, and read-only MCP research servers.",
	agents: {
		research: {
			title: "Research",
			role: "specialist",
			does: "desk research on the web for any project: markets, products, companies, people's public work, technical questions",
			model: "claude-haiku-5-5",
			effort: "medium",
			tools: ["web_search", "web_fetch", "library_search", "library_read", "publish_page", "read_page", "read_skill", "save_skill"],
			mcp: ["deepwiki", "github"],
			share: 0.13,
			parallelJobs: 4,
			searchesPerJob: 20,
		},
		radar: {
			title: "Radar",
			role: "specialist",
			does: "watches for new models, datasets, repos and techniques the operator's projects could use, judged against their profiles; daily sweep, weekly radar, time-critical alerts",
			model: "claude-sonnet-5-5",
			effort: "medium",
			tools: ["web_search", "web_fetch", "library_search", "library_read", "publish_page", "read_page", "read_skill", "alert_operator"],
			mcp: ["huggingface", "github", "deepwiki"],
			share: 0.14,
			parallelJobs: 2,
			searchesPerJob: 25,
		},
	},
	tools: {
		web_search: { kit: "web", risks: ["untrusted", "egress"] },
		web_fetch: { kit: "web", risks: ["untrusted", "egress"] },
	},
	kits: {
		web: async (h) => (await import("./web.ts")).webKit(h.searchGuard, () => secret(h.env, "ANTHROPIC_API_KEY")),
	},
	mcp: {
		// Answers questions about public GitHub repositories from their code and docs. Free, no account. The question leaves.
		deepwiki: { url: "https://mcp.deepwiki.com/mcp", risks: ["egress"], allow: ["read_wiki_structure", "read_wiki_contents", "ask_wiki_question"] },
		// Hugging Face's official server: search models, datasets, Spaces and papers on the Hub, read model and dataset cards.
		// Used without a token (public data only). Checked against /mcp on 2026-10-11: search and details only; hf_fs (repo
		// file access) and hf_whoami stay hidden.
		huggingface: { url: "https://huggingface.co/mcp", risks: ["egress"], allow: ["hub_repo_search", "hub_repo_details"] },
		// GitHub's official server, with a token that reads public repositories only. Read tools only: no writes even if the
		// token allowed them. Checked against /mcp on 2026-10-11. Hidden on purpose: get_me (the token's owner), collaborators
		// and teams (other people), run_secret_scanning, ui_get.
		github: {
			url: "https://api.githubcopilot.com/mcp/",
			risks: ["egress"],
			tokenSecret: "GITHUB_TOKEN",
			headers: { "X-MCP-Readonly": "true" },
			allow: [
				"search_repositories", "search_code", "search_commits", "search_issues", "search_pull_requests", "search_users",
				"get_file_contents", "list_commits", "get_commit", "list_branches", "list_tags", "get_tag",
				"list_releases", "get_latest_release", "get_release_by_tag",
				"list_issues", "issue_read", "get_label", "list_pull_requests", "pull_request_read",
			],
		},
	},
	director: (host) => host,
	rpc: {
		/** For the developer on the server: one web search (a cent), with its block types and error codes. */
		search: async (host, q) => {
			const { default: Anthropic } = await import("@anthropic-ai/sdk");
			return (await import("./web.ts")).search(String(q ?? ""), new Anthropic({ apiKey: await host.ctx.secret("ANTHROPIC_API_KEY") }));
		},
	},
	needs: { secrets: ["GITHUB_TOKEN"] },
});
