// MCP servers: declared once in MCP_SERVERS, given to agents by name in fleet.ts (`mcp: [...]`). The Agents SDK's MCP
// client keeps the connection (restored after the object sleeps); this file turns the allowed tools into pi tools.
//
// Adding a server:
//   1. An entry below: its URL, the risks its tools carry (tools.ts), and an allow-list (empty at first is fine).
//   2. If it needs a token: its name in SECRET_NAMES (and OPTIONAL_SECRETS) in secrets.ts, a binding in
//      cloudflare.config.ts, and a prompt in scripts/secrets.sh so the operator can type it in.
//   3. Its name in an agent's `mcp` list; `npm run deploy`; `/mcp` in General lists every tool the server offers,
//      allowed or hidden. Copy the ones the agent should have into `allow` and deploy again.
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension, type ToolRegistration } from "@earendil-works/pi-durable";
import type { Agent } from "agents";
import { lazy } from "./lazy.ts";
import { plugins } from "./plugins.gen.ts";
import { isSet, type SecretName, secret } from "./secrets.ts";
import type { Risk } from "./tools.ts";

export type McpServerSpec = {
	/** Streamable HTTP (or SSE) endpoint. */
	url: string;
	/** What the allowed tools expose besides their answers, which always count as untrusted. */
	risks: Risk[];
	/** The server's tool names an agent may call. Everything else stays hidden: never allow one that sends, deletes or pays. */
	allow: string[];
	/** The secret (secrets.ts) holding a bearer token, for servers that need one. OAuth servers are not supported yet. */
	tokenSecret?: SecretName;
	/** Extra request headers the server understands, such as a read-only switch. */
	headers?: Record<string, string>;
};

export const CORE_MCP = {
} satisfies Record<string, McpServerSpec>;

/** Core's MCP servers and every enabled plugin's (plugin.ts). */
export const MCP_SERVERS: Record<string, McpServerSpec> = lazy(() => Object.assign({}, CORE_MCP, ...plugins().map((p) => p.mcp ?? {})));

export type McpName = string;
export const isMcpName = (name: string): name is McpName => Object.hasOwn(MCP_SERVERS, name);

/** Risks an agent takes on with these servers: their declared ones, plus untrusted for the answers themselves. */
export const mcpRisks = (names: readonly McpName[]): Risk[] =>
	names.length ? ["untrusted", ...names.flatMap((n) => MCP_SERVERS[n]?.risks ?? [])] : [];

/** The pi name of an MCP tool: `mcp_<server>_<tool>`, within the API's 64 characters of [a-zA-Z0-9_-]. */
export const piToolName = (server: string, tool: string) => `mcp_${server}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

/** The parts of an Agent the bridge uses. */
export type McpHost = Pick<Agent<Env>, "addMcpServer" | "removeMcpServer" | "mcp">;

const OUTPUT_MAX_CHARS = 40_000;
const CONNECT_WAIT_MS = 8_000;

type McpContent = { type: string; text?: string; resource?: { uri?: string; text?: string } };

/** An MCP tool result as text for the model; images and binary parts are named, not passed. */
export function resultText(content: readonly McpContent[] | undefined): string {
	const text = (content ?? [])
		.map((c) => (c.type === "text" ? (c.text ?? "") : c.type === "resource" ? (c.resource?.text ?? `[resource ${c.resource?.uri ?? ""}]`) : `[${c.type} omitted]`))
		.join("\n")
		.trim();
	return text.length > OUTPUT_MAX_CHARS ? `${text.slice(0, OUTPUT_MAX_CHARS)}\n\n[cut at ${OUTPUT_MAX_CHARS} characters]` : text || "(empty result)";
}

/** Brings the object's MCP connections in line with `names`: adds missing ones, drops ones no longer configured. */
async function sync(host: McpHost, names: readonly McpName[], env: Env) {
	const rows = host.mcp.listServers();
	for (const row of rows) {
		const spec = isMcpName(row.name) && names.includes(row.name) ? MCP_SERVERS[row.name] : undefined;
		if (!spec || spec.url !== row.server_url) await host.removeMcpServer(row.id);
	}
	const kept = new Set(host.mcp.listServers().map((r) => r.name));
	for (const name of names) {
		if (kept.has(name)) continue;
		const spec: McpServerSpec = MCP_SERVERS[name];
		const token = spec.tokenSecret ? await secret(env, spec.tokenSecret) : undefined;
		if (spec.tokenSecret && !isSet(token ?? "")) {
			console.log(`mcp ${name}: ${spec.tokenSecret} is not set yet; skipped`);
			continue;
		}
		const headers = { ...(spec.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
		try {
			const r = await host.addMcpServer(name, spec.url, { id: name, transport: Object.keys(headers).length ? { headers } : undefined });
			if (r.state !== "ready") {
				console.error(`mcp ${name}: wants OAuth, which the fleet does not support yet; removed`);
				await host.removeMcpServer(r.id);
			}
		} catch (err) {
			console.error(`mcp ${name}: connect failed:`, err);
		}
	}
	await host.mcp.waitForConnections({ timeout: CONNECT_WAIT_MS });
}

/** Connects the servers and returns their allowed tools as one pi extension. A server that is down just has no tools. */
export async function mcpKit(host: McpHost, names: readonly McpName[], env: Env): Promise<{ extension: Extension; tools: ToolRegistration[] }> {
	await sync(host, names, env);
	const tools: ToolRegistration[] = [];
	for (const name of names) {
		const allow = new Set<string>(MCP_SERVERS[name].allow);
		for (const t of host.mcp.listTools({ serverName: name })) {
			if (!allow.has(t.name)) continue;
			tools.push(
				defineTool({
					name: piToolName(name, t.name),
					description: `[${name} MCP] ${(t.description ?? t.name).slice(0, 1000)}`,
					parameters: Type.Unsafe<Record<string, unknown>>(t.inputSchema),
					execute: async (args) => {
						const r = (await host.mcp.callTool({ serverId: t.serverId, name: t.name, arguments: args })) as { content?: McpContent[]; isError?: boolean };
						return { content: [{ type: "text", text: resultText(r.content) }], isError: r.isError === true };
					},
				}) as ToolRegistration,
			);
		}
	}
	return { extension: defineExtension({ name: "mcp", tools }), tools };
}

/** `/mcp`: per server, its state and every tool it offers, allowed (✓) or hidden (·). */
export function mcpStatus(host: McpHost, names: readonly McpName[]): string {
	if (!names.length) return "no MCP servers";
	const rows = host.mcp.listServers();
	return names
		.map((name) => {
			const row = rows.find((r) => r.name === name);
			if (!row) return `${name}: not connected`;
			const state = host.mcp.mcpConnections[row.id]?.connectionState ?? "unknown";
			const allow = new Set<string>(MCP_SERVERS[name].allow);
			const offered = host.mcp.listTools({ serverName: name }).map((t) => `${allow.has(t.name) ? "✓" : "·"} ${t.name}`);
			return `${name}: ${state}${offered.length ? `\n   ${offered.join("\n   ")}` : ""}`;
		})
		.join("\n");
}
