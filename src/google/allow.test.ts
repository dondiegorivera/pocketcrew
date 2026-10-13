import assert from "node:assert/strict";
import { needs } from "../test-needs.ts";
import { test } from "node:test";
import { type Allowed, allow, familiesOf } from "./allow.ts";

const G = "https://gmail.googleapis.com/gmail/v1/users/me";
const C = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const ok = (r: Allowed | string) => typeof r !== "string";

test("reading, labelling with the fleet's labels and drafting are allowed", () => {
	assert.ok(ok(allow({ method: "GET", url: `${G}/messages?q=in%3Ainbox&maxResults=20` })));
	assert.ok(ok(allow({ method: "GET", url: `${G}/threads/18c2f?format=full` })));
	assert.ok(ok(allow({ method: "GET", url: `${G}/settings/sendAs` })));
	assert.ok(ok(allow({ method: "POST", url: `${G}/labels`, body: { name: "pocketcrew/fyi" } })));
	assert.ok(ok(allow({ method: "POST", url: `${G}/labels`, body: { name: "Money/Invoices", labelListVisibility: "labelShow" } })), "the operator's own labels, nested");
	assert.ok(ok(allow({ method: "PATCH", url: `${G}/labels/Label_3`, body: { name: "Travel and car" } })), "renaming one");
	assert.ok(ok(allow({ method: "POST", url: `${G}/messages/batchModify`, body: { ids: ["a"], addLabelIds: ["Label_12"], removeLabelIds: [] } })));
	assert.ok(ok(allow({ method: "POST", url: `${G}/drafts`, body: { message: { raw: "x" } } })));
	assert.ok(ok(allow({ method: "PUT", url: `${G}/drafts/r-123`, body: {} })));
});

test("sending, trash, delete, spam, untraceable archiving and system labels are refused", () => {
	assert.ok(!ok(allow({ method: "POST", url: `${G}/messages/send`, body: {} })));
	assert.ok(!ok(allow({ method: "POST", url: `${G}/drafts/send`, body: { id: "r-1" } })));
	assert.ok(!ok(allow({ method: "POST", url: `${G}/messages/abc/trash` })));
	assert.ok(!ok(allow({ method: "POST", url: `${G}/messages/batchDelete`, body: { ids: ["a"] } })));
	assert.ok(!ok(allow({ method: "POST", url: `${G}/messages/abc/modify`, body: { removeLabelIds: ["INBOX"] } })), "an archive without the fleet's label");
	assert.ok(!ok(allow({ method: "POST", url: `${G}/messages/batchModify`, body: { ids: ["a"], removeLabelIds: ["INBOX", "UNREAD"], addLabelIds: ["Label_9"] } })), "no other system labels");
	assert.ok(!ok(allow({ method: "POST", url: `${G}/messages/batchModify`, body: { ids: ["a"], addLabelIds: ["TRASH"] } })));
	assert.ok(!ok(allow({ method: "POST", url: `${G}/messages/batchModify`, body: { ids: ["a"], addLabelIds: ["SPAM"] } })));
	assert.ok(ok(allow({ method: "POST", url: `${G}/messages/batchModify`, body: { ids: ["a"], addLabelIds: ["IMPORTANT"] } })), "importance may be set");
	assert.ok(ok(allow({ method: "POST", url: `${G}/messages/batchModify`, body: { ids: ["a"], removeLabelIds: ["IMPORTANT"] } })), "and cleared");
	assert.ok(!ok(allow({ method: "POST", url: `${G}/messages/batchModify`, body: { ids: ["a"], removeLabelIds: ["INBOX"], addLabelIds: ["IMPORTANT"] } })), "importance does not stand in for a fleet label");
	assert.ok(!ok(allow({ method: "POST", url: `${G}/labels`, body: { name: "Important" } })));
	assert.ok(!ok(allow({ method: "DELETE", url: `${G}/labels/Label_3` } as never)), "labels are never deleted");
	assert.ok(!ok(allow({ method: "PATCH", url: `${G}/labels/INBOX`, body: { name: "Box" } })), "system labels are never renamed");
	assert.ok(!ok(allow({ method: "PATCH", url: `${G}/labels/Label_3`, body: { name: "Money", color: { textColor: "#000000" } } })), "only name and visibility");
	assert.ok(!ok(allow({ method: "POST", url: `${G}/settings/filters`, body: {} })));
	assert.ok(!ok(allow({ method: "PUT", url: `${G}/settings/autoForwarding`, body: {} })));
	assert.ok(!ok(allow({ method: "GET", url: "https://gmail.googleapis.com/gmail/v1/users/someone@example.com/messages" })));
});

test("archiving with the fleet's label, and moving back to the inbox, are allowed", () => {
	assert.ok(ok(allow({ method: "POST", url: `${G}/messages/batchModify`, body: { ids: ["a"], removeLabelIds: ["INBOX"], addLabelIds: ["Label_9"] } })));
	assert.ok(ok(allow({ method: "POST", url: `${G}/messages/batchModify`, body: { ids: ["a"], addLabelIds: ["INBOX"], removeLabelIds: ["Label_9"] } })));
});

test("calendar changes never carry guests and never send update emails", () => {
	const create = allow({ method: "POST", url: C, body: { summary: "Dentist" } }) as Allowed;
	assert.match(create.url, /sendUpdates=none/);
	assert.match((allow({ method: "PATCH", url: `${C}/ev1?sendUpdates=all`, body: { summary: "x" } }) as Allowed).url, /sendUpdates=none/);
	assert.ok(!ok(allow({ method: "POST", url: C, body: { summary: "Call", attendees: [{ email: "p@example.com" }] } })));
	assert.ok(!ok(allow({ method: "PATCH", url: `${C}/ev1`, body: { attendees: [] } })));
	assert.ok(ok(allow({ method: "GET", url: `${C}?timeMin=2026-10-11T00%3A00%3A00%2B02%3A00` })));
	assert.ok(!ok(allow({ method: "PUT", url: `${C}/ev1`, body: {} })), "only PATCH");
	assert.ok(!ok(allow({ method: "POST", url: "https://www.googleapis.com/calendar/v3/calendars/primary/acl", body: {} })), "no sharing");
});

test("documents: create and read freely; edit only what the fleet created or the operator allowed, and only by adding or replacing", () => {
	const D = "https://docs.googleapis.com/v1/documents";
	const S = "https://sheets.googleapis.com/v4/spreadsheets";
	assert.equal((allow({ method: "POST", url: D, body: { title: "x" } }) as Allowed).recordsCreated, true);
	const edit = (requests: unknown[]) => allow({ method: "POST", url: `${D}/abc:batchUpdate`, body: { requests } });
	assert.equal((edit([{ insertText: { endOfSegmentLocation: {}, text: "x" } }]) as Allowed).mustBeEditable, "abc");
	assert.ok(ok(edit([{ replaceAllText: { containsText: { text: "{{total}}" }, replaceText: "412.50" } }])));
	assert.ok(!ok(edit([{ deleteContentRange: { range: { startIndex: 1, endIndex: 900 } } }])), "no range deletes");
	assert.ok(!ok(edit([{ insertText: {}, replaceAllText: {} }])), "one change per request");
	assert.ok(!ok(edit([])));
	assert.equal((allow({ method: "POST", url: `${S}/s1/values/A1:append?valueInputOption=USER_ENTERED`, body: {} }) as Allowed).mustBeEditable, "s1");
	assert.equal((allow({ method: "PUT", url: `${S}/s1/values/Q3!B2%3AD9?valueInputOption=USER_ENTERED`, body: {} }) as Allowed).mustBeEditable, "s1");
	assert.equal((allow({ method: "POST", url: `${S}/s1:batchUpdate`, body: { requests: [{ addSheet: { properties: { title: "Q3" } } }] } }) as Allowed).mustBeEditable, "s1");
	assert.ok(!ok(allow({ method: "POST", url: `${S}/s1:batchUpdate`, body: { requests: [{ deleteSheet: { sheetId: 0 } }] } })), "no deleting tabs");
	assert.ok(!ok(allow({ method: "POST", url: `${S}/s1/values/A1%3AZ9:clear`, body: {} })), "no clearing");
	assert.ok(ok(allow({ method: "GET", url: `${S}/s1?fields=sheets.properties` })), "tab names");
	assert.ok(ok(allow({ method: "GET", url: `${G}/messages/m1/attachments/ANGjdJ9x-_y` })), "attachments can be read");
	assert.ok(ok(allow({ method: "GET", url: `${S}/s1/values/A1%3AZ500` })));
	assert.ok(!ok(allow({ method: "POST", url: "https://www.googleapis.com/drive/v3/files/abc/permissions", body: {} })), "no sharing");
	assert.ok(ok(allow({ method: "GET", url: "https://www.googleapis.com/drive/v3/files?q=" })), "finding files in the Drive is reading");
});

test("each agent reaches only its own part of Google", { skip: needs("google") }, () => {
	assert.deepEqual([...familiesOf("mail")], ["gmail"]);
	assert.deepEqual([...familiesOf("calendar")], ["calendar"]);
	assert.deepEqual([...familiesOf("clerk")].sort(), ["calendar", "docs", "gmail"]);
	assert.deepEqual([...familiesOf("research")], []);
	assert.deepEqual([...familiesOf("lead")], []);
	assert.deepEqual([...familiesOf("director")], ["gmail", "calendar"], "the mail watch and the briefing's calendar line");
	assert.deepEqual([...familiesOf("mail~4")], ["gmail"], "a job worker has its agent's access");
});

test("standing filters only label, may skip the inbox with a label, and never forward, trash or mark read", () => {
	const filter = (action: unknown, criteria: unknown = { from: "news@example.com" }) => allow({ method: "POST", url: `${G}/settings/filters`, body: { criteria, action } });
	assert.ok(ok(allow({ method: "GET", url: `${G}/settings/filters` })));
	assert.ok(ok(filter({ addLabelIds: ["Label_3"] })));
	assert.ok(ok(filter({ addLabelIds: ["Label_3", "Label_4"], removeLabelIds: ["INBOX"] })));
	assert.ok(!ok(filter({ removeLabelIds: ["INBOX"] })), "skipping the inbox without a fleet label");
	assert.ok(!ok(filter({ addLabelIds: ["Label_3"], forward: "x@example.com" })));
	assert.ok(!ok(filter({ addLabelIds: ["TRASH"] })));
	assert.ok(!ok(filter({ addLabelIds: ["Label_3"], removeLabelIds: ["UNREAD"] })));
	assert.ok(ok(filter({ addLabelIds: ["Label_3", "IMPORTANT"] })), "mark important");
	assert.ok(ok(filter({ addLabelIds: ["Label_3"], removeLabelIds: ["IMPORTANT", "INBOX"] })), "never important, skip the inbox");
	assert.ok(!ok(filter({ addLabelIds: ["IMPORTANT"] })), "importance alone: not recognisable as the fleet's");
	assert.ok(!ok(filter({ addLabelIds: ["Label_3", "IMPORTANT"], removeLabelIds: ["IMPORTANT"] })));
	assert.ok(!ok(filter({ addLabelIds: ["Label_3"] }, {})), "no criteria would catch all mail");
	assert.ok(!ok(allow({ method: "DELETE" as "GET", url: `${G}/settings/filters/abc` })));
});

test("Drive: search, metadata, download and export are read-only", () => {
	const D = "https://www.googleapis.com/drive/v3/files";
	assert.ok(ok(allow({ method: "GET", url: `${D}?q=name%20contains%20%27Steuer%27&pageSize=20` })));
	assert.ok(ok(allow({ method: "GET", url: `${D}/1AbC_d-9?fields=id,name,mimeType` })));
	assert.ok(ok(allow({ method: "GET", url: `${D}/1AbC_d-9?alt=media`, binary: true })));
	assert.ok(ok(allow({ method: "GET", url: `${D}/1AbC_d-9/export?mimeType=text/plain` })));
	assert.ok(!ok(allow({ method: "PATCH", url: `${D}/1AbC_d-9`, body: { name: "x" } })), "no renaming");
	assert.ok(!ok(allow({ method: "POST", url: `${D}/1AbC_d-9/permissions`, body: { role: "reader" } })), "no sharing");
	assert.ok(!ok(allow({ method: "POST", url: `${D}/1AbC_d-9/copy`, body: {} })));
	assert.ok(!ok(allow({ method: "GET", url: `${D}/1AbC_d-9/permissions` })));
});
