import assert from "node:assert/strict";
import { test } from "node:test";
import { isTextDocument, readTextDocument, withFile } from "./attachments.ts";
import { Bot } from "./telegram.ts";

const b = new Bot("token", "chat");

test("text files are recognised by type or name; others are declined before downloading", async (t) => {
	assert.ok(isTextDocument({ file_id: "1", file_name: "spec.md", mime_type: "application/octet-stream" }));
	assert.ok(isTextDocument({ file_id: "1", mime_type: "text/plain" }));
	assert.ok(!isTextDocument({ file_id: "1", file_name: "deck.pdf", mime_type: "application/pdf" }));
	const fetch = t.mock.method(globalThis, "fetch", async () => new Response("{}"));
	await assert.rejects(readTextDocument(b, { file_id: "1", file_name: "deck.pdf" }), /text files/);
	await assert.rejects(readTextDocument(b, { file_id: "1", file_name: "big.md", file_size: 10_000_000 }), /KB/);
	assert.equal(fetch.mock.callCount(), 0);
});

test("readTextDocument downloads through the Bot API and decodes UTF-8", async (t) => {
	t.mock.method(globalThis, "fetch", async (url: string) =>
		url.endsWith("/getFile") ? Response.json({ ok: true, result: { file_path: "documents/f.md" } }) : new Response("# Spec\nCrème brûlée"),
	);
	assert.equal(await readTextDocument(b, { file_id: "1", file_name: "f.md" }), "# Spec\nCrème brûlée");
});

test("withFile keeps the caption first and marks where the file starts and ends", () => {
	assert.equal(withFile("save as a skill", "memo.md", "X"), "save as a skill\n\n[attached file memo.md]\nX\n[end of file]");
	assert.match(withFile(undefined, undefined, "X"), /^\(a file, no message\)/);
});
