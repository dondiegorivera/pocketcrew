import assert from "node:assert/strict";
import { test } from "node:test";
import { allow, type ApiRequest } from "../../../src/google/allow.ts";
import type { GoogleApi } from "../../../src/google/connector.ts";
import { docsKit, inTab } from "./docs.ts";

/** A fake connector that refuses what allow.ts refuses, and treats only "mine" as editable. */
function fakeDocs() {
	const sent: ApiRequest[] = [];
	const api: GoogleApi = {
		request: async (_agent, req) => {
			const a = allow(req);
			if (typeof a === "string") return { ok: false, status: 403, data: { error: a } };
			if (a.mustBeEditable && a.mustBeEditable !== "mine") return { ok: false, status: 403, data: { error: "only reading" } };
			sent.push(req);
			if (req.url.includes(":batchUpdate") && req.url.includes("documents")) return { ok: true, status: 200, data: { replies: [{ replaceAllText: { occurrencesChanged: 2 } }] } };
			if (req.url.includes("fields=sheets")) return { ok: true, status: 200, data: { sheets: [{ properties: { title: "Q3" } }, { properties: { title: "Summary" } }] } };
			if (req.method === "GET" && req.url.includes("/values/")) return { ok: true, status: 200, data: { range: "'Q3'!A5:C6", values: [["a", "b"], ["c", "d"]] } };
			return { ok: true, status: 200, data: {} };
		},
	};
	const tools = Object.fromEntries((docsKit(async () => api, "clerk").tools ?? []).map((t) => [t.name, t]));
	const run = async (name: string, args: object) => (await tools[name]!.execute(args as never, {} as never, {} as never)) as { content: { text: string }[]; isError?: boolean };
	return { sent, run };
}

test("a tab name is quoted for Sheets ranges", () => {
	assert.equal(inTab(undefined, "A1"), "A1");
	assert.equal(inTab("Q3 2026", "B2"), "'Q3 2026'!B2");
	assert.equal(inTab("Bob's", "A1"), "'Bob''s'!A1");
});

test("docs_replace replaces in editable docs only and says how often", async () => {
	const { sent, run } = fakeDocs();
	assert.match((await run("docs_replace", { doc: "https://docs.google.com/document/d/mine/edit", find: "{{total}}", replace: "412.50" })).content[0]!.text, /Replaced 2 occurrences/);
	assert.deepEqual(sent.at(-1)!.body, { requests: [{ replaceAllText: { containsText: { text: "{{total}}", matchCase: true }, replaceText: "412.50" } }] });
	assert.equal((await run("docs_replace", { doc: "theirs", find: "x", replace: "y" })).isError, true);
});

test("sheets_update writes in place from one cell, in a tab; sheets_add_tab adds a tab with rows", async () => {
	const { sent, run } = fakeDocs();
	assert.match((await run("sheets_update", { sheet: "mine", start: "b2", rows: [["=SUM(D2:D9)"]], tab: "Q3" })).content[0]!.text, /from B2 in Q3/);
	const put = sent.at(-1)!;
	assert.equal(put.method, "PUT");
	assert.ok(put.url.endsWith(`/values/${encodeURIComponent("'Q3'!B2")}?valueInputOption=USER_ENTERED`));
	assert.equal((await run("sheets_update", { sheet: "mine", start: "A1:C9", rows: [] })).isError, true, "start is one cell");
	await run("sheets_add_tab", { sheet: "mine", title: "Summary", rows: [["Total", "=SUM(Q3!D:D)"]] });
	assert.deepEqual(sent.at(-2)!.body, { requests: [{ addSheet: { properties: { title: "Summary" } } }] });
	assert.equal(sent.at(-1)!.method, "PUT");
	assert.equal((await run("sheets_update", { sheet: "theirs", start: "A1", rows: [["x"]] })).isError, true);
});

test("sheets_read numbers rows from the range's start and names the tabs", async () => {
	const { run } = fakeDocs();
	const text = (await run("sheets_read", { sheet: "theirs", tab: "Q3", range: "A5:C6" })).content[0]!.text;
	assert.match(text, /^Tabs: Q3, Summary/);
	assert.match(text, /\n5\ta\tb\n6\tc\td$/);
});

test("Drive: search by words in name or content, newest first; read a Google Doc as text, refuse a folder", async () => {
	const sent: ApiRequest[] = [];
	const api: GoogleApi = {
		request: async (_agent, req) => {
			if (typeof allow(req) === "string") return { ok: false, status: 403, data: { error: allow(req) } };
			sent.push(req);
			if (req.url.includes("/files?")) return { ok: true, status: 200, data: { files: [
				{ id: "old1234567890", name: "Anschreiben 2024", mimeType: "application/vnd.google-apps.document", modifiedTime: "2025-03-01T00:00:00Z", webViewLink: "https://docs.google.com/document/d/old1234567890/edit" },
				{ id: "new1234567890", name: "Anschreiben 2025.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", modifiedTime: "2026-03-01T00:00:00Z" },
			] } };
			if (req.url.includes("/export?")) return { ok: true, status: 200, data: "Sehr geehrte Frau X,\nanbei die Unterlagen." };
			if (req.url.includes("folder1234567")) return { ok: true, status: 200, data: { id: "folder1234567", name: "Steuer", mimeType: "application/vnd.google-apps.folder" } };
			return { ok: true, status: 200, data: { id: "old1234567890", name: "Anschreiben 2024", mimeType: "application/vnd.google-apps.document", modifiedTime: "2025-03-01T00:00:00Z" } };
		},
	};
	const tools = Object.fromEntries((docsKit(async () => api, "clerk").tools ?? []).map((t) => [t.name, t]));
	const run = async (name: string, args: object) => ((await tools[name]!.execute(args as never, {} as never, {} as never)) as { content: { text: string }[] }).content[0]!.text;

	const found = await run("drive_search", { words: "Steuerberater Anschreiben" });
	assert.match(found, /^- Anschreiben 2025\.docx · vnd\.openxmlformats-officedocument\.wordprocessingml\.document · 2026-03-01/);
	assert.match(found, /\n- Anschreiben 2024 · Google Doc · 2025-03-01 · https:\/\/docs\.google\.com/);
	assert.equal(new URL(sent[0]!.url).searchParams.get("q"), "(name contains 'Steuerberater' or fullText contains 'Steuerberater') and (name contains 'Anschreiben' or fullText contains 'Anschreiben') and trashed = false");

	assert.match(await run("drive_read", { file: "https://docs.google.com/document/d/old1234567890/edit" }), /Anschreiben 2024 \(Google Doc, 2025-03-01\)\n\nSehr geehrte Frau X/);
	assert.match(sent.at(-1)!.url, /old1234567890\/export\?mimeType=text%2Fplain$/);
	assert.match(await run("drive_read", { file: "folder1234567" }), /is a folder/);
});
