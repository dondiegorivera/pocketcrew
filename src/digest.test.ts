import assert from "node:assert/strict";
import { test } from "node:test";
import { briefingText, type DoneJob, inboxText, jobKind, localDay, todayText, unreadRoutines } from "./digest.ts";

const AGENTS = ["mail", "calendar", "clerk", "research"];
const job = (over: Partial<DoneJob>): DoneJob => ({ id: 1, key: "routine:7:2026-10-12 07:15", agent: "research", status: "done", title: "Six new models", summary: "Signal: small models\nPage: https://reports.example/hf/1.html", cost: 0.05, created: 0, finished: 0, ...over });
// Monday 2026-10-12 10:05 in Berlin (UTC+2)
const NOW = Date.UTC(2026, 9, 12, 8, 5);

test("job kinds come from the key", () => {
	assert.equal(jobKind("mailwatch:abc:2"), "mail");
	assert.equal(jobKind("routine:7:2026-10-12 07:15"), "routine");
	assert.equal(jobKind("wish:3"), "wish");
	assert.equal(jobKind("dispatch:xyz"), "asked");
	assert.equal(jobKind("inbox:812"), "tap");
	assert.equal(jobKind("react:4410:note"), "tap");
	assert.equal(localDay(NOW), "2026-10-12");
});

test("the briefing: one line per routine with its page, needs-you and failures marked", () => {
	const text = briefingText(
		NOW,
		[
			{ name: "morning-hf-trending", job: job({}) },
			{ name: "outreach-mon-thu", job: job({ agent: "outreach", title: "Two prices needed", summary: "STATUS: needs-operator\nITEMS: 0\nNEXT: none" }) },
			{ name: "radar-rotation", job: job({ status: "failed" }) },
		],
		["scout-every-two-days"],
		AGENTS,
	)!;
	assert.equal(
		text,
		"☀️ Monday 12 Oct\n• morning-hf-trending: Six new models\n  🔗 https://reports.example/hf/1.html\n• outreach-mon-thu: Two prices needed · 👉 needs you\n• radar-rotation: ⚠️ failed\nStill running: scout-every-two-days",
	);
	assert.equal(briefingText(NOW, [], [], AGENTS), undefined, "nothing to say, no message");
});

test("the inbox line counts mails, says what needed the operator and lists titles", () => {
	const mail = (id: number, title: string, status = "done") => job({ id, key: `mailwatch:${id}:1`, agent: "mail", title, summary: `STATUS: ${status}\nITEMS: 1\nNEXT: none` });
	const text = inboxText([mail(1, "Newsletter archived"), mail(2, "Bank asks for a document", "needs-operator")], AGENTS)!;
	assert.equal(text, "📬 Inbox: 2 mails sorted · 1 needed you (sent at the time)\n• Newsletter archived\n• Bank asks for a document");
	assert.equal(inboxText([], AGENTS), undefined);
});

test("/today groups routines, mail and the operator's own jobs", () => {
	const text = todayText(
		NOW,
		[job({}), job({ id: 2, key: "mailwatch:a:1", agent: "mail", title: "x", summary: "STATUS: done\nITEMS: 3\nNEXT: none" }), job({ id: 3, key: "dispatch:t", agent: "mail", title: "Label review" }), job({ id: 4, key: "routine:19:x", status: "running", title: null })],
		(key) => (key.startsWith("routine:7") ? "morning-hf-trending" : "radar-rotation"),
		AGENTS,
		"Spent $1.44 of $4.98 today.",
	);
	assert.match(text, /^📅 Monday 12 Oct\nRoutines \(2\):\n• morning-hf-trending: Six new models/);
	assert.match(text, /• radar-rotation: running/);
	assert.match(text, /Mail: 1 check, 3 mails sorted, none needed you/);
	assert.match(text, /Your jobs \(1\):\n• #3 mail: Label review/);
	assert.match(text, /Spent \$1\.44 of \$4\.98 today\.$/);
});

test("routines nobody reads: three or more pages in two weeks, none opened", () => {
	const runs = [1, 2, 3].flatMap((n) => [{ routine: "github", page: `g${n}` }, { routine: "hf", page: `h${n}` }]).concat([{ routine: "bmad-weekly", page: "b1" }]);
	assert.deepEqual(unreadRoutines(runs, new Set(["h2"])), ["github"]);
});
