import assert from "node:assert/strict";
import { needs } from "./test-needs.ts";
import { test } from "node:test";
import type { AgentSpec } from "./fleet.ts";
import { FLEET } from "./fleet.ts";
import { type McpHost, mcpKit, piToolName, resultText } from "./mcp.ts";
import { NotesStore } from "./notes.ts";
import { memorySql } from "./test-sql.ts";
import { KITS, type ToolHost, toolsFor } from "./toolkits.ts";
import { TOOLS, type ToolName } from "./tools.ts";

const unused = () => {
	throw new Error("not used here");
};
const host = (mcp: Partial<McpHost> = {}): ToolHost => ({
	env: {} as Env,
	director: unused,
	library: unused,
	siteUrl: "https://reports.example",
	published: () => {},
	agent: "research",
	searchGuard: { refuse: async () => undefined, record: () => {} },
	notes: new NotesStore(memorySql()),
	mcp: mcp as McpHost,
	google: unused,
	repos: unused,
	copy: unused,
	alert: unused,
});

test("every tool in the catalog is built by the kit the catalog names, and no kit builds an unlisted tool", { skip: needs("notes", "web") }, async () => {
	for (const [kit, build] of Object.entries(KITS)) {
		const built = ((await build(host(), { ...(FLEET.research as AgentSpec), repos: ["notes"] })).tools ?? []).map((t) => t.name).sort();
		const listed = (Object.keys(TOOLS) as ToolName[]).filter((t) => TOOLS[t].kit === kit).sort();
		assert.deepEqual(built, listed, kit);
	}
});

test("toolsFor offers exactly the tools an agent names", { skip: needs("web") }, async () => {
	const spec: AgentSpec = { ...(FLEET.research as AgentSpec), tools: ["web_search", "library_read"], mcp: [] };
	const { extensions, tools } = await toolsFor(spec, host());
	assert.deepEqual(extensions.map((e) => e.name), ["web", "library"]);
	assert.deepEqual(tools.map((t) => t.name), ["web_search", "library_read"]);
});

test("mcpKit offers only allow-listed tools, under mcp_<server>_<tool>, and returns their text", { skip: needs("web") }, async () => {
	const calls: unknown[] = [];
	const fake: Partial<McpHost> = {
		addMcpServer: (async () => ({ id: "deepwiki", state: "ready" })) as unknown as McpHost["addMcpServer"],
		removeMcpServer: async () => {},
		mcp: {
			listServers: () => [],
			waitForConnections: async () => {},
			listTools: () => [
				{ name: "ask_wiki_question", description: "Ask", inputSchema: { type: "object", properties: { q: { type: "string" } } }, serverId: "deepwiki" },
				{ name: "delete_everything", description: "No", inputSchema: { type: "object" }, serverId: "deepwiki" },
			],
			callTool: async (params: unknown) => (calls.push(params), { content: [{ type: "text", text: "answer" }, { type: "image" }] }),
		} as unknown as McpHost["mcp"],
	};
	const { tools } = await mcpKit(fake as McpHost, ["deepwiki"], {} as Env);
	assert.deepEqual(tools.map((t) => t.name), ["mcp_deepwiki_ask_wiki_question"]);
	const out = await tools[0]!.execute({ q: "how?" }, {} as never, {} as never);
	assert.deepEqual(calls, [{ serverId: "deepwiki", name: "ask_wiki_question", arguments: { q: "how?" } }]);
	assert.equal((out as { content: { text: string }[] }).content[0]!.text, "answer\n[image omitted]");
});

test("piToolName and resultText keep to the API's limits", () => {
	assert.equal(piToolName("my.server", "do/thing"), "mcp_my_server_do_thing");
	assert.equal(piToolName("s", "x".repeat(100)).length, 64);
	assert.equal(resultText([]), "(empty result)");
	assert.match(resultText([{ type: "text", text: "y".repeat(50_000) }]), /\[cut at 40000 characters\]$/);
});

test("the GitHub server is skipped until its token is set, then connects with the token and the read-only header", { skip: needs("web") }, async () => {
	const added: { name: string; options: unknown }[] = [];
	const fake = {
		addMcpServer: (async (name: string, _url: string, options: unknown) => (added.push({ name, options }), { id: name, state: "ready" })) as unknown as McpHost["addMcpServer"],
		removeMcpServer: async () => {},
		mcp: { listServers: () => [], waitForConnections: async () => {}, listTools: () => [], callTool: async () => ({}) } as unknown as McpHost["mcp"],
	} as McpHost;
	await mcpKit(fake, ["github"], { GITHUB_TOKEN: "unset" } as unknown as Env);
	assert.deepEqual(added, [], "placeholder: not connected");
	await mcpKit(fake, ["github"], { GITHUB_TOKEN: "github_pat_x" } as unknown as Env);
	assert.deepEqual(added[0], { name: "github", options: { id: "github", transport: { headers: { "X-MCP-Readonly": "true", authorization: "Bearer github_pat_x" } } } });
});
