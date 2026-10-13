// The operator's notes: Markdown files by topic in a server-only git repo, filed by the Notes agent and edited by the
// operator in Obsidian over the tailnet (server/: the git server, its password, the one-time setup).
import { definePlugin } from "../../src/plugin.ts";

export default definePlugin({
	name: "notes",
	about: "The operator's notes as Markdown by topic, filed by an agent and edited in Obsidian over the tailnet.",
	agents: {
		notes: {
			title: "Notes",
			role: "specialist",
			does: "the operator's notes as Markdown files by topic (ideas, links per topic, trips with their expenses, anything to keep): files each note where it belongs, opens a topic when a new one shows up, keeps totals and the index; the operator reads and edits the same files in Obsidian",
			model: "claude-haiku-5-5",
			effort: "medium",
			tools: ["repo_files", "repo_read", "repo_grep", "repo_write", "read_skill"],
			mcp: [],
			repos: ["notes"],
			share: 0.03,
			parallelJobs: 1,
			searchesPerJob: 0,
		},
	},
	repoViews: {
		// Agents add and rewrite files; git keeps every version, and nothing is deleted. Server only, never mirrored.
		notes: {
			repo: "notes",
			risks: ["private"],
			include: ["**/*.md"],
			exclude: [".obsidian/**", ".trash/**"],
			writable: ["**/*.md"],
			about: "The operator's notes: Markdown files by topic (README.md is the index, inbox.md the unsorted), also edited by the operator in Obsidian.",
			everyMinute: true,
		},
	},
	help: [],
});
