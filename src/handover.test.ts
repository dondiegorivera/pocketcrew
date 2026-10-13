import assert from "node:assert/strict";
import { test } from "node:test";
import { handoverKit, MAX_COPY_CHARS } from "./handover.ts";

test("send_copy hands over the label and the bare text separately, and refuses what one message cannot hold", async () => {
	const sent: [string, string][] = [];
	const tool = handoverKit(async (label, text) => void sent.push([label, text])).tools![0]!;
	const run = async (args: object) => (await tool.execute(args as never, {} as never, {} as never)) as { content: { text: string }[]; isError?: boolean };
	await run({ label: "LinkedIn note to Jane Doe (Ory),\n 120 characters", text: "  Hi Jane, I hold authorizationgate.com …  " });
	assert.deepEqual(sent, [["LinkedIn note to Jane Doe (Ory), 120 characters", "Hi Jane, I hold authorizationgate.com …"]]);
	assert.equal((await run({ label: "x", text: "y".repeat(MAX_COPY_CHARS + 1) })).isError, true);
	assert.equal(sent.length, 1);
});
