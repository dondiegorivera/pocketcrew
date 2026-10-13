// Web tools. pi-ai's Anthropic adapter does not pass server tools through, so `web_search` makes its own Messages API
// call with Anthropic's web search tool and hands back the findings; `web_fetch` is a plain fetch from the Worker.
import Anthropic from "@anthropic-ai/sdk";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { priced } from "../../src/anthropic.ts";
import type { SearchGuard } from "../../src/toolkits.ts";

const SEARCH_MODEL = "claude-haiku-5-5";
// The basic search tool. The dynamic-filtering version (web_search_20260209) is documented for Opus and Sonnet only: Haiku
// accepted it but its searches failed with invalid_tool_input and then max_uses_exceeded (2026-10-11), at three times the
// searches per call.
const SEARCH_TOOL = "web_search_20250305";

const FETCH_MAX_CHARS = 40_000;

/** What the tools ask of the agent that runs them: the daily search budget. */

export type Findings = { text: string; sources: string[]; searches: number; errors: string[]; usage: ReturnType<typeof priced>; blocks: string[] };

/** The error codes of failed searches in a response (web_search_tool_result_error), such as max_uses_exceeded. */
export function searchErrors(content: readonly Anthropic.ContentBlock[]): string[] {
	return content.flatMap((b) =>
		b.type === "web_search_tool_result" && !Array.isArray(b.content) && b.content.type === "web_search_tool_result_error" ? [b.content.error_code] : [],
	);
}

export async function search(query: string, client = new Anthropic()): Promise<Findings> {
	const messages: Anthropic.MessageParam[] = [
		{
			role: "user",
			content:
				`Search the web for: ${query}\n\n` +
				"Report what is relevant, concisely, with the source URL after each finding. Say so if nothing reliable turns up.",
		},
	];
	const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	let searches = 0;
	let response: Anthropic.Message | undefined;
	// A server tool loop can stop with pause_turn; sending the partial turn back continues it.
	for (let round = 0; round < 4; round++) {
		response = await client.messages.create({
			model: SEARCH_MODEL,
			max_tokens: 8000,
			output_config: { effort: "low" },
			tools: [{ type: SEARCH_TOOL, name: "web_search", max_uses: 3 }],
			messages,
		});
		tokens.input += response.usage.input_tokens;
		tokens.output += response.usage.output_tokens;
		tokens.cacheRead += response.usage.cache_read_input_tokens ?? 0;
		tokens.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
		searches += response.usage.server_tool_use?.web_search_requests ?? 0;
		if (response.stop_reason !== "pause_turn") break;
		messages.push({ role: "assistant", content: response.content });
	}
	const usage = priced(SEARCH_MODEL, tokens, searches);
	const content = response?.content ?? [];
	const errors = searchErrors(content);
	const blocks = content.map((b) => b.type);
	if (response?.stop_reason === "refusal") return { text: "The search was declined by the model's safety checks.", sources: [], searches, errors, usage, blocks };
	const text = (response?.content ?? []).flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
	const sources = [
		...new Set(
			(response?.content ?? []).flatMap((b) =>
				b.type === "text" ? (b.citations ?? []).flatMap((c) => (c.type === "web_search_result_location" ? [c.url] : [])) : [],
			),
		),
	];
	return { text, sources, searches, errors, usage, blocks };
}

/** When every search in a call failed: the error codes and what to do, so the agent sees a failure rather than prose. */
export function searchFailure(found: Pick<Findings, "errors" | "searches" | "text" | "sources">): string | undefined {
	if (!found.errors.length || found.sources.length || /https?:\/\//.test(found.text)) return undefined;
	const codes = [...new Set(found.errors)].join(", ");
	const hint = /query_too_long|invalid_tool_input/.test(codes)
		? "Retry once with a short plain query (a few words, no quotes or site: operators)."
		: /too_many_requests|unavailable/.test(codes)
			? "The search service is busy; retry once later in the run, then work from other sources."
			: "Work from other sources (web_fetch on known pages, MCP tools) and say in the report that search failed.";
	return `Search failed (${codes}). ${hint}`;
}

/** Readable text of an HTML page: no scripts, styles or tags, entities for the common characters, whitespace collapsed. */
export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export async function fetchPage(url: string): Promise<string> {
	const u = new URL(url);
	if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("only http and https URLs");
	const res = await fetch(u, {
		headers: { "user-agent": "pocketcrew/0.1", accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1" },
		redirect: "follow",
		signal: AbortSignal.timeout(20_000),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${u}`);
	const type = res.headers.get("content-type") ?? "";
	if (!/text\/|json|xml/.test(type)) throw new Error(`not a text page (${type || "no content type"})`);
	const body = await res.text();
	const text = /html/.test(type) ? htmlToText(body) : body;
	return text.length > FETCH_MAX_CHARS ? `${text.slice(0, FETCH_MAX_CHARS)}\n\n[cut at ${FETCH_MAX_CHARS} characters]` : text;
}

/** The web tools; an agent is offered the ones its fleet.ts entry names. */
export const webKit = (guard: SearchGuard, apiKey: () => Promise<string>): Extension =>
	defineExtension({
		name: "web",
		tools: [
			defineTool({
				name: "web_search",
				description: "Search the web. Returns findings with source URLs. Costs money per search, so search with purpose.",
				parameters: Type.Object({ query: Type.String({ description: "What to look for, as a focused search query" }) }),
				// Rerunning after an eviction costs one more search, which beats losing the result.
				replay: "safe",
				execute: async ({ query }) => {
					const refusal = await guard.refuse();
					if (refusal) return { content: [{ type: "text", text: refusal }], isError: true };
					const found = await search(query, new Anthropic({ apiKey: await apiKey() }));
					guard.record(found.searches);
					const sources = found.sources.length ? `\n\nSources:\n${found.sources.join("\n")}` : "";
					const failed = searchFailure(found);
					if (failed) return { content: [{ type: "text", text: failed }], isError: true, usage: found.usage };
					return { content: [{ type: "text", text: (found.text || "No results.") + sources }], usage: found.usage };
				},
			}),
			defineTool({
				name: "web_fetch",
				description: "Read a web page as plain text. Use it on URLs from search results or from the operator.",
				parameters: Type.Object({ url: Type.String({ description: "An http(s) URL" }) }),
				replay: "safe",
				execute: async ({ url }) => ({ content: [{ type: "text", text: await fetchPage(url) }] }),
			}),
		],
	});
