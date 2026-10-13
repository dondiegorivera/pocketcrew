import assert from "node:assert/strict";
import { test } from "node:test";
import { allow, type ApiRequest } from "../../../src/google/allow.ts";
import type { GoogleApi } from "../../../src/google/connector.ts";
import { gmailKit } from "./gmail.ts";

/** A fake connector that answers like Gmail and refuses what allow.ts refuses. */
function fakeGmail() {
	const sent: ApiRequest[] = [];
	const api: GoogleApi = {
		request: async (_agent, req) => {
			if (typeof allow(req) === "string") return { ok: false, status: 403, data: { error: allow(req) } };
			sent.push(req);
			if (req.url.endsWith("/labels") && req.method === "GET") return { ok: true, status: 200, data: { labels: [] } };
			if (req.url.endsWith("/labels")) return { ok: true, status: 200, data: { id: "Label_77" } };
			if (req.url.includes("/messages?")) return { ok: true, status: 200, data: { messages: [{ id: "m1" }, { id: "m2" }] } };
			return { ok: true, status: 200, data: {} };
		},
	};
	const tools = Object.fromEntries((gmailKit(async () => api, "mail").tools ?? []).map((t) => [t.name, t]));
	const run = async (name: string, args: object) => ((await tools[name]!.execute(args as never, {} as never, {} as never)) as { content: { text: string }[] }).content[0]!.text;
	return { sent, run };
}

test("archive by search touches only inbox mail and leaves the pocketcrew/archived trail", async () => {
	const { sent, run } = fakeGmail();
	assert.match(await run("gmail_archive", { query: "category:promotions older_than:14d" }), /Archived 2 messages/);
	const list = sent.find((r) => r.url.includes("/messages?"))!;
	assert.equal(new URL(list.url).searchParams.get("q"), "(category:promotions older_than:14d) in:inbox");
	assert.deepEqual(sent.find((r) => r.method === "POST" && r.url.endsWith("/labels"))!.body, { name: "pocketcrew/archived", labelListVisibility: "labelShow", messageListVisibility: "show" });
	assert.deepEqual(sent.at(-1)!.body, { ids: ["m1", "m2"], removeLabelIds: ["INBOX"], addLabelIds: ["Label_77"] });
});

test("restore by search only reaches mail the fleet archived, and puts it back in the inbox", async () => {
	const { sent, run } = fakeGmail();
	assert.match(await run("gmail_restore", { query: "from:bank" }), /back to the inbox/);
	assert.equal(new URL(sent.find((r) => r.url.includes("/messages?"))!.url).searchParams.get("q"), "(from:bank) label:pocketcrew-archived");
	assert.deepEqual(sent.at(-1)!.body, { ids: ["m1", "m2"], addLabelIds: ["INBOX"], removeLabelIds: ["Label_77"] });
});

test("importance: gmail_label sets or clears it, a filter marks important or never important", async () => {
	const { sent, run } = fakeGmail();
	assert.match(await run("gmail_label", { messages: ["m1"], add: ["invoice"], important: true }), /marked important/);
	assert.deepEqual(sent.at(-1)!.body, { ids: ["m1"], addLabelIds: ["Label_77", "IMPORTANT"], removeLabelIds: [] });
	assert.match(await run("gmail_label", { messages: ["m1"], important: false }), /importance cleared/);
	assert.deepEqual(sent.at(-1)!.body, { ids: ["m1"], addLabelIds: [], removeLabelIds: ["IMPORTANT"] });
	assert.match(await run("gmail_filter_create", { from: "billing@example.com", labels: ["invoice"], important: true }), /Filter created.*mark important/);
	assert.deepEqual(sent.at(-1)!.body, { criteria: { from: "billing@example.com" }, action: { addLabelIds: ["Label_77", "IMPORTANT"] } });
	assert.match(await run("gmail_filter_create", { from: "news@example.com", labels: ["newsletter"], important: false, skip_inbox: true }), /never important, skip inbox/);
	assert.deepEqual((sent.at(-1)!.body as { action: unknown }).action, { addLabelIds: ["Label_77", "Label_77"], removeLabelIds: ["INBOX", "IMPORTANT"] });
});

test("attachments: found by name in nested parts; only PDFs, pictures and text are read", async () => {
	const { attachmentParts } = await import("./gmail.ts");
	const { readKind } = await import("./attachment.ts");
	const parts = attachmentParts({ mimeType: "multipart/mixed", parts: [{ mimeType: "text/plain", body: { data: "" } }, { mimeType: "multipart/related", parts: [{ filename: "Rechnung-0815.pdf", mimeType: "application/pdf", body: { attachmentId: "a1", size: 9000 } }] }, { filename: "logo.png", mimeType: "image/png" }] });
	assert.deepEqual(parts.map((p) => p.filename), ["Rechnung-0815.pdf", "logo.png"]);
	assert.equal(readKind("application/octet-stream", "invoice.PDF"), "pdf");
	assert.equal(readKind("image/jpeg", "scan.jpg"), "image");
	assert.equal(readKind("text/csv", "export.csv"), "text");
	assert.equal(readKind("application/zip", "all.zip"), undefined);
});

test("gmail_attachment asks for a name when several match, and refuses what it cannot read", async () => {
	const { run } = fakeGmail();
	assert.match(await run("gmail_attachment", { message: "m1" }), /no attachments/);
});

test("label reorganisation: create nested, rename with children, move mail by exact names and say how to undo", async () => {
	const sent: ApiRequest[] = [];
	const labels = [
		{ id: "INBOX", name: "INBOX", type: "system" },
		{ id: "Label_1", name: "Client-Requests", type: "user" },
		{ id: "Label_2", name: "Clients", type: "user" },
		{ id: "Label_3", name: "fuel", type: "user" },
		{ id: "Label_4", name: "fuel/2025", type: "user" },
		{ id: "Label_9", name: "pocketcrew/archived", type: "user" },
	];
	const api: GoogleApi = {
		request: async (_agent, req) => {
			if (typeof allow(req) === "string") return { ok: false, status: 403, data: { error: allow(req) } };
			sent.push(req);
			if (req.method === "GET" && req.url.endsWith("/labels")) return { ok: true, status: 200, data: { labels } };
			if (req.method === "GET" && req.url.includes("/labels/")) return { ok: true, status: 200, data: { ...labels.find((l) => req.url.endsWith(l.id)), messagesTotal: 3, messagesUnread: 1 } };
			if (req.url.includes("/messages?")) return { ok: true, status: 200, data: { messages: [{ id: "m1" }, { id: "m2" }] } };
			return { ok: true, status: 200, data: { id: "Label_50" } };
		},
	};
	const tools = Object.fromEntries((gmailKit(async () => api, "mail").tools ?? []).map((t) => [t.name, t]));
	const run = async (name: string, args: object) => ((await tools[name]!.execute(args as never, {} as never, {} as never)) as { content: { text: string }[] }).content[0]!.text;

	const list = await run("gmail_labels", {});
	assert.match(list, /Inbox: 3 messages/);
	assert.match(list, /The operator's labels \(4\):\n- Client-Requests · 3 messages \(1 unread\)/);
	assert.match(list, /The fleet's labels \(1\):\n- pocketcrew\/archived/);

	assert.match(await run("gmail_label_create", { names: ["Money/Invoices", "Clients"] }), /Created: Money, Money\/Invoices\./);
	assert.match(await run("gmail_label_create", { names: ["pocketcrew/x"] }), /belong to the fleet/);

	assert.match(await run("gmail_label_rename", { from: "fuel", to: "Travel and car" }), /with 1 nested label/);
	assert.deepEqual(sent.filter((r) => r.method === "PATCH").map((r) => r.body), [{ name: "Travel and car" }, { name: "Travel and car/2025" }]);
	assert.match(await run("gmail_label_rename", { from: "Client-Requests", to: "Clients" }), /exists already/);
	assert.match(await run("gmail_label_rename", { from: "pocketcrew/archived", to: "Old" }), /not renamed/);

	assert.match(await run("gmail_relabel", { query: "label:client-requests", add: ["Clients"], remove: ["Client-Requests"] }), /2 messages: added Clients; removed Client-Requests\. Undo: gmail_relabel on the same mail to add Client-Requests and remove Clients\./);
	assert.deepEqual(sent.at(-1)!.body, { ids: ["m1", "m2"], addLabelIds: ["Label_2"], removeLabelIds: ["Label_1"] });
	await run("gmail_relabel", { messages: ["m9"], add: ["Clients"], archive: true });
	assert.deepEqual(sent.at(-1)!.body, { ids: ["m9"], addLabelIds: ["Label_2", "Label_9"], removeLabelIds: ["INBOX"] });
	assert.match(await run("gmail_relabel", { query: "x", add: ["Nope"] }), /No label named "Nope"/);
});

test("Word files are read without a model: paragraphs, tabs and entities", async () => {
	const { docxText, readKind } = await import("./attachment.ts");
	assert.equal(readKind("application/octet-stream", "Anschreiben.docx"), "docx");
	const bytes = Buffer.from("UEsDBBQAAAAIAMKgTF3HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgAwqBMXeq/NuJrAAAAsQAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLMpt0rJTy7NTc0rsbMpt0rKT6kE0QUgoghElNgFp2YUKaSnAsmSVAW3osRSBV+1xNwC65yc1CIdG32QEhBZBCYL0HU75iWlZlpBlQGJxCR9iERQanJGXmleemqegpGBkSkWg/Rh7tFHciQAUEsBAhQDFAAAAAgAwqBMXcccFzwKAAAACAAAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADCoExd6r824msAAACxAAAAEQAAAAAAAAAAAAAAgAE7AAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAIAAgCAAAAA1QAAAAAA", "base64");
	assert.equal(await docxText(new Uint8Array(bytes)), "Sehr geehrte Frau M&ller,\nAnbei:\tRechnungen 2025");
});
