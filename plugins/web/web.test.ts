import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { htmlToText, search, searchFailure } from "./web.ts";

test("htmlToText drops scripts and tags and keeps line structure", () => {
	const html = "<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Title</h1><p>One &amp; two</p><p>Three</p></body></html>";
	assert.equal(htmlToText(html), "Title\nOne & two\nThree");
});

const message = (over: Partial<Anthropic.Message>): Anthropic.Message =>
	({
		id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
		content: [],
		usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 1 } },
		...over,
	}) as unknown as Anthropic.Message;

const fake = (replies: (Anthropic.Message | Error)[]) => {
	const calls: Anthropic.MessageCreateParams[] = [];
	const client = {
		messages: {
			create: async (p: Anthropic.MessageCreateParams) => {
				calls.push(structuredClone(p));
				const r = replies.shift()!;
				if (r instanceof Error) throw r;
				return r;
			},
		},
	} as unknown as Anthropic;
	return { client, calls };
};

test("search continues after pause_turn, prices tokens plus searches, and collects cited sources", async () => {
	const cited = { type: "text", text: "Fact.", citations: [{ type: "web_search_result_location", url: "https://a.example", title: "A", cited_text: "", encrypted_index: "" }] };
	const { client, calls } = fake([message({ stop_reason: "pause_turn", content: [] }), message({ content: [cited] as Anthropic.ContentBlock[] })]);
	const found = await search("query", client);
	assert.equal(calls.length, 2);
	assert.equal(calls[1]!.messages.at(-1)!.role, "assistant");
	assert.equal(found.text, "Fact.");
	assert.deepEqual(found.sources, ["https://a.example"]);
	assert.equal(found.searches, 2);
	// 2000 input at $0.10/M + 400 output at $0.50/M + 2 searches at $0.01
	assert.ok(Math.abs(found.usage.cost.total - (0.0002 + 0.0002 + 0.02)) < 1e-9);
});

test("search uses the basic web search tool, which Haiku supports", async () => {
	const { client, calls } = fake([message({ content: [{ type: "text", text: "ok", citations: null }] as Anthropic.ContentBlock[] })]);
	assert.equal((await search("q", client)).text, "ok");
	assert.equal((calls[0]!.tools![0] as { type: string }).type, "web_search_20250305");
});

test("a call whose searches all failed reads as a failure with the error codes, not as prose", async () => {
	const failed = { type: "web_search_tool_result", tool_use_id: "s", content: { type: "web_search_tool_result_error", error_code: "invalid_tool_input" } };
	const prose = { type: "text", text: "I couldn't get any search results.", citations: null };
	const { client } = fake([message({ content: [failed, failed, prose] as Anthropic.ContentBlock[] })]);
	const found = await search("q", client);
	assert.deepEqual(found.errors, ["invalid_tool_input", "invalid_tool_input"]);
	assert.match(searchFailure(found) ?? "", /^Search failed \(invalid_tool_input\)\. Retry once with a short plain query/);
	assert.equal(searchFailure({ ...found, text: "One finding. Source: https://a.example" }), undefined, "a partial failure with results is still a result");
});
