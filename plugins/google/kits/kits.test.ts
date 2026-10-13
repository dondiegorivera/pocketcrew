import assert from "node:assert/strict";
import { test } from "node:test";
import { eventTimes, instant, offsetAt, reminderSet, repeatRule } from "./calendar.ts";
import { docText, fileId } from "./docs.ts";
import { bodyText, rawDraft } from "./mime.ts";

test("a message reads as its plain text, else its HTML as text, with attachments named", () => {
	const b64 = (s: string) => Buffer.from(s).toString("base64url");
	const plain = bodyText({ mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("Hello Zoë") } }, { mimeType: "text/html", body: { data: b64("<p>Hi</p>") } }] }, { mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "a" } }] });
	assert.deepEqual(plain, { text: "Hello Zoë", attachments: ["invoice.pdf"] });
	assert.equal(bodyText({ mimeType: "text/html", body: { data: b64("<p>Only <b>HTML</b></p>") } }).text, "Only HTML");
});

test("a draft is a proper UTF-8 message, threaded, and headers cannot be smuggled in", () => {
	const raw = Buffer.from(rawDraft({ from: "Me <me@example.com>", to: "a@example.com\r\nBcc: evil@example.com", subject: "Facture Q3 reçue", body: "Hallo,\ndanke schön.", inReplyTo: "<m1@x>" }), "base64url").toString("utf8");
	const [head, body] = raw.split("\r\n\r\n");
	assert.match(head!, /^From: Me <me@example.com>\r\nTo: a@example.com Bcc: evil@example.com\r\n/);
	assert.ok(!/^Bcc:/m.test(head!), "no injected header");
	assert.match(head!, /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
	assert.match(head!, /In-Reply-To: <m1@x>\r\nReferences: <m1@x>/);
	assert.equal(Buffer.from(body!.replace(/\r\n/g, ""), "base64").toString("utf8"), "Hallo,\r\ndanke schön.");
});

test("calendar times are the operator's local time, with Berlin's summer and winter offsets", () => {
	assert.equal(offsetAt("2026-07-01T10:00"), "+02:00");
	assert.equal(offsetAt("2026-12-01T10:00"), "+01:00");
	assert.equal(instant("2026-10-14"), "2026-10-14T00:00:00+02:00");
	assert.deepEqual(eventTimes("2026-10-14T15:00", undefined), { start: { dateTime: "2026-10-14T15:00:00", timeZone: "Europe/Berlin" }, end: { dateTime: "2026-10-14T16:00:00", timeZone: "Europe/Berlin" } });
	assert.deepEqual(eventTimes("2026-10-14", "2026-10-15"), { start: { date: "2026-10-14" }, end: { date: "2026-10-16" } }, "all-day end is exclusive");
	assert.match(eventTimes("tomorrow 3pm", undefined) as string, /YYYY-MM-DDTHH:MM/);
});

test("docs: ids from links, and a document's text with its tables", () => {
	assert.equal(fileId("https://docs.google.com/document/d/1AbC_d-9/edit?usp=sharing"), "1AbC_d-9");
	assert.equal(fileId("https://docs.google.com/spreadsheets/d/XyZ/edit#gid=0"), "XyZ");
	assert.equal(fileId(" plainId "), "plainId");
	const text = docText([
		{ paragraph: { elements: [{ textRun: { content: "Title\n" } }] } },
		{ table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "a\n" } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: "b\n" } }] } }] }] }] } },
	]);
	assert.equal(text, "Title\na\tb\n");
});

test("repeats and reminders become Calendar's RRULE and popup overrides", () => {
	assert.deepEqual(repeatRule("weekly", "2026-10-14T09:00", "2026-12-31"), ["RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z"]);
	assert.deepEqual(repeatRule("Yearly", "2026-11-02"), ["RRULE:FREQ=YEARLY"]);
	assert.deepEqual(repeatRule("monthly", "2026-11-02", "2027-06-30"), ["RRULE:FREQ=MONTHLY;UNTIL=20270630"], "all-day: a date");
	assert.deepEqual(repeatRule("daily", "2026-10-14T07:00", undefined, 10), ["RRULE:FREQ=DAILY;COUNT=10"]);
	assert.match(repeatRule("fortnightly", "2026-10-14") as string, /one of/);
	assert.deepEqual(reminderSet([1440, 60]), { useDefault: false, overrides: [{ method: "popup", minutes: 1440 }, { method: "popup", minutes: 60 }] });
	assert.deepEqual(reminderSet([]), { useDefault: false, overrides: [] });
	assert.equal(typeof reminderSet([1, 2, 3, 4, 5, 6]), "string");
});
