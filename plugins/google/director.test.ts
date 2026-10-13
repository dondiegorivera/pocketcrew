import assert from "node:assert/strict";
import { test } from "node:test";
import { finish, testDirector } from "../../src/director/test-kit.ts";
import google from "./plugin.ts";

const NEEDS = "STATUS: needs-operator\nITEMS: 1\nNEXT: none";
const QUIET = "STATUS: done\nITEMS: 2\nNEXT: none";

test("mail triage: quiet unless a mail needs the operator; then Needs you with buttons, and the Lead hears quietly", async () => {
	const t = testDirector(undefined, [google]);
	await t.s.jobs.create("mailwatch:m1:1", "mail", "triage");
	await finish(t, 1, QUIET, "Newsletter archived");
	assert.equal(t.tg.said.length, 0);
	assert.equal(t.called("jobResult").length, 0);
	await t.s.jobs.create("mailwatch:m2:1", "mail", "triage");
	await finish(t, 2, NEEDS, "Bank asks for a document");
	assert.match(t.tg.last().text, /^📬 Needs you: Bank asks for a document/);
	assert.deepEqual(t.tg.last().opts?.buttons?.[0]?.map((b) => b.data), ["m:d:2", "m:a:2", "m:t:2"]);
	assert.equal(t.called("jobResult", "lead")[0]!.args[4], true, "quiet for the Lead");
	await t.s.buttons.handle(t.tap("m:d:2"));
	assert.match(t.tg.answers.at(-1)!.text!, /Mail is drafting a reply \(job #3\)/);
	await finish(t, 3, "Drafted.", "Reply drafted to the bank");
	assert.equal(t.tg.last().text, "✓ Reply drafted to the bank", "a tap's job reports back itself");
	assert.equal(t.tg.last().opts?.silent, true);
});

test("/inbox: a card with buttons, archive with the trail, move to a label, always archive a sender", async () => {
	const t = testDirector(undefined, [google]);
	t.google.routes.push(
		{ method: "GET", match: "/messages?q=in%3Ainbox", data: { messages: [{ id: "m1" }, { id: "m2" }] } },
		{ method: "GET", match: "/messages/m1?", data: { snippet: "Hello &amp; welcome", labelIds: ["INBOX"], payload: { headers: [{ name: "From", value: "Shop <news@shop.example>" }, { name: "Subject", value: "Sale" }, { name: "Date", value: "Mon, 12 Oct 2026 07:00:00 +0000" }] } } },
		{ method: "GET", match: "/messages/m2?", data: { snippet: "", payload: { headers: [{ name: "From", value: "Ann <ann@example.com>" }, { name: "Subject", value: "Lunch?" }] } } },
		{ method: "GET", match: "/labels/Label_7", data: { name: "Money" } },
		{ method: "GET", match: "/labels", data: { labels: [{ id: "Label_1", name: "pocketcrew/archived", type: "user" }, { id: "Label_7", name: "Money", type: "user" }] } },
		{ method: "GET", match: "from%3Anews%40shop.example", data: { messages: [{ id: "m1" }, { id: "m9" }] } },
	);
	await t.s.commands.dispatch(t.text("/inbox"));
	assert.match(t.tg.last().text, /^📥 2 to go\n\nShop <news@shop\.example>\nSale\n2026-10-12 09:00\n\nHello & welcome$/);
	assert.equal(t.tg.last().opts?.buttons?.[0]?.[0]?.data, "i:a:m1");
	await t.s.buttons.handle(t.tap("i:a:m1"));
	assert.deepEqual(t.google.requests.find((r) => r.method === "POST")!.body, { ids: ["m1"], removeLabelIds: ["INBOX"], addLabelIds: ["Label_1"] });
	assert.match(t.tg.last().text, /^📥 1 to go\n\nAnn/, "the next card follows");
	await t.s.buttons.handle(t.tap("i:m:m2"));
	assert.deepEqual(t.tg.edits.at(-1)!.buttons?.[0]?.map((b) => b.data), ["i:M:m2:Label_7"], "the operator's labels, not the fleet's");
	await t.s.buttons.handle(t.tap("i:M:m2:Label_7"));
	assert.match(t.tg.answers.at(-1)!.text!, /Moved to Money/);
	await t.s.commands.dispatch(t.text("/inbox"));
	await t.s.buttons.handle(t.tap("i:F:m1"));
	const filter = t.google.requests.find((r) => r.url.endsWith("/settings/filters"))!;
	assert.deepEqual(filter.body, { criteria: { from: "news@shop.example" }, action: { addLabelIds: ["Label_1"], removeLabelIds: ["INBOX"] } });
	assert.match(t.tg.answers.at(-1)!.text!, /skips the inbox from now on; 2 archived now/);
});

test("the briefing's first line is today's calendar, read without a model", async () => {
	const t = testDirector(Date.UTC(2026, 9, 12, 8, 5), [google]);
	t.google.routes.push({ method: "GET", match: "/calendar/v3/calendars/primary/events", data: { items: [{ summary: "Dentist", start: { dateTime: "2026-10-12T12:00:00Z" } }, { summary: "Holiday", start: { date: "2026-10-12" } }] } });
	await t.s.digests.run();
	assert.match(t.tg.last().text, /^☀️ Monday 12 Oct\n📅 Today: 14:00 Dentist · all day Holiday/);
});

test("onboarding: the Google line follows the sign-in, with a button to sign in", async () => {
	const t = testDirector(undefined, [google]);
	const line = async () => {
		await t.s.commands.dispatch(t.text("/start"));
		return t.tg.last();
	};
	t.google.statusValue = { ...t.google.statusValue, configured: false, connected: false };
	assert.match((await line()).text, /▫️ Google: create an OAuth client/);
	t.google.statusValue = { ...t.google.statusValue, configured: true, connected: false };
	const m = await line();
	assert.match(m.text, /▫️ Google: sign in/);
	assert.ok(m.opts?.buttons?.flat().some((b) => b.data === "o:google"));
	t.google.statusValue = { ...t.google.statusValue, connected: true, missing: [] };
	assert.match((await line()).text, /✅ Google: signed in/);
});
