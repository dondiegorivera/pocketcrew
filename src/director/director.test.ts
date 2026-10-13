import assert from "node:assert/strict";
import { needs } from "../test-needs.ts";
import { test } from "node:test";
import type { JobRef } from "../agent.ts";
import { finish, testDirector } from "./test-kit.ts";

const NEEDS = "STATUS: needs-operator\nITEMS: 1\nNEXT: none";
const QUIET = "STATUS: done\nITEMS: 2\nNEXT: none";

test("jobs: a request starts on its agent's worker with its brief, and its result goes back to the Lead", { skip: needs("google", "web") }, async () => {
	const t = testDirector();
	assert.match(await t.s.jobs.create("dispatch:a", "research", "Find three papers"), /Job #1 started with research/);
	const run = t.called("runJob")[0]!;
	assert.equal(run.agent, "research~1", "research runs parallel jobs on workers");
	assert.equal((run.args[0] as JobRef).task, "Find three papers");
	await finish(t, 1, "Three papers found.", "Three papers");
	const result = t.called("jobResult", "lead")[0]!;
	assert.deepEqual(result.args.slice(0, 3), [1, "research", "done"]);
	assert.match(String(result.args[3]), /Three papers found\./);
	assert.match(await t.s.jobs.create("dispatch:b", "mail", "x", undefined, [], undefined, [1]), /Job #2/, "a public result may feed a private agent");
	await finish(t, 2, QUIET, "Mail found");
	assert.match(await t.s.jobs.create("dispatch:c", "research", "x", undefined, [], undefined, [2]), /must not get/, "a private result never reaches a web agent");
});

test("reactions: likes become feedback, ✍ files into the notes, 👀 comes back tomorrow, 🤔 asks for plainer", { skip: needs("notes", "web") }, async () => {
	const t = testDirector();
	await t.s.jobs.create("dispatch:a", "research", "models");
	await finish(t, 1, "Six models.", "Six new models", "done", 4242);
	await t.s.reactions.react(4242, ["❤"]);
	assert.equal(t.s.jobs.get(1)!.rating, "up");
	assert.match(String(t.called("setFeedback", "research")[0]!.args[0]), /liked: Six new models/);
	await t.s.jobs.create("dispatch:b", "research", "more models");
	assert.match(String((t.called("runJob").at(-1)!.args[0] as JobRef).feedback), /liked: Six new models/, "the next job's brief carries it");
	await t.s.reactions.react(4242, ["✍"]);
	const note = t.s.jobs.byKey("react:4242:note")!;
	assert.equal(note.agent, "notes");
	assert.equal(note.inputs, "[1]");
	await t.s.reactions.react(4242, ["🤔"]);
	assert.equal(t.called("explain", "research").length, 1);
	await t.s.reactions.react(4242, ["👀"]);
	const before = t.tg.said.length;
	await t.s.reminders.due();
	assert.equal(t.tg.said.length, before, "not yet");
	t.advance(24 * 3_600_000);
	await t.s.reminders.due();
	assert.match(t.tg.last().text, /^👀 From yesterday:\n📄 Six new models/);
	await t.s.reactions.react(999, ["❤"]);
	assert.equal(t.tg.last().text.startsWith("👀"), true, "a message the fleet did not send is ignored");
});

test("briefing at 10:00: calendar, routines with links, what waits, the credit's expiry; the inbox line at 18:00, silent", { skip: needs("google", "web") }, async () => {
	const t = testDirector(Date.UTC(2026, 9, 12, 5, 30)); // 07:30 Berlin
	t.s.digests.top.push(() => ["📅 Today: 14:00 Dentist"]);
	assert.match(await t.s.routines.save("hf-trending", "research", "15 7 * * *", "models"), /Routine #1 "hf-trending" saved/);
	assert.equal(t.schedules.filter((s) => s.callback === "runRoutine").length, 1);
	await t.s.routines.run(1);
	const job = t.s.jobs.withKey("routine:1:", ["running"])[0]!;
	await finish(t, job.id, "Signal\nPage: https://reports.example/hf/1.html", "Six models");
	assert.equal(t.tg.said.length, 0, "before the briefing, a routine waits for it");
	t.s.spend.setCredit("50 2026-10-15");
	t.s.digests.waiting.push(() => ["🏷 1 domain decision waiting · /sales"]);
	await t.s.jobs.create("mailwatch:x:1", "mail", "triage");
	await finish(t, job.id + 1, QUIET, "Newsletter archived");
	t.setNow(Date.UTC(2026, 9, 12, 8, 5)); // 10:05
	await t.s.digests.run();
	const b = t.tg.last().text;
	assert.match(b, /^☀️ Monday 12 Oct\n📅 Today: 14:00 Dentist\n• hf-trending: Six models\n  🔗 https:\/\/reports\.example\/hf\/1\.html/);
	assert.match(b, /🏷 1 domain decision waiting · \/sales/);
	assert.match(b, /💳 The credit expires in 3 days/);
	await t.s.digests.run();
	assert.equal(t.tg.said.filter((s) => s.text.startsWith("☀️")).length, 1, "once a day");
	t.setNow(Date.UTC(2026, 9, 12, 16, 5)); // 18:05
	await t.s.digests.run();
	assert.match(t.tg.last().text, /^📬 Inbox: 2 mails sorted · none needed you\n• Newsletter archived$/);
	assert.equal(t.tg.last().opts?.silent, true);
	t.setNow(Date.UTC(2026, 9, 12, 20, 5)); // 22:05: the nightly cost line, once, silent
	await t.s.digests.run();
	await t.s.digests.run();
	assert.equal(t.tg.said.filter((s) => s.text.startsWith("🧾 Today")).length, 1);
	assert.equal(t.tg.last().opts?.silent, true);
});

test("routines: the briefing's stop button asks once more, then stops; ratings reach the next run's brief", { skip: needs("web") }, async () => {
	const t = testDirector();
	await t.s.routines.save("gh", "research", "0 9 * * *", "repos");
	await t.s.routines.run(1);
	const job = t.s.jobs.withKey("routine:1:", ["running"])[0]!;
	await finish(t, job.id, "x", "Ten repos", "done", 77);
	await t.s.reactions.react(77, ["👎"]);
	assert.match(t.s.routines.ratingsLine(1), /👎 #1 "Ten repos"/);
	await t.s.buttons.handle(t.tap("r:s:1"));
	assert.match(t.tg.edits.at(-1)!.text, /Stop the routine "gh"\?/);
	await t.s.buttons.handle(t.tap("r:y:1"));
	assert.match(t.tg.answers.at(-1)!.text!, /Routine #1 "gh" deleted/);
	assert.equal(t.schedules.filter((s) => s.callback === "runRoutine").length, 0);
});

test("commands: General text goes to the Lead, topic text to its agent; commands answer in place", { skip: needs("notes") }, async () => {
	const t = testDirector();
	t.sql("INSERT INTO topics VALUES ('notes', 77)");
	await t.s.commands.dispatch(t.text("hello"));
	assert.equal(t.called("receive", "lead").length, 1);
	await t.s.commands.dispatch(t.text("file this", 77));
	assert.equal(t.called("receive", "notes").length, 1);
	await t.s.commands.dispatch(t.text("/status", 77));
	assert.match(t.tg.last().text, /^💤 notes \(notes\) · haiku-5-5/);
	await t.s.commands.dispatch(t.text("/today"));
	assert.match(t.tg.last().text, /^📅 Monday 12 Oct\nNo routines ran today\./);
	await t.s.commands.dispatch(t.text("/budget lift"));
	assert.match(t.tg.last().text, /^Per-agent caps are lifted until midnight UTC/);
	await t.s.commands.dispatch(t.text("/nope"));
	assert.match(t.tg.last().text, /^Write to the Lead here in General/);
	await t.s.buttons.handle(t.tap("zz:1:2"));
	assert.match(t.tg.answers.at(-1)!.text!, /older version/);
});

test("onboarding: a new instance shows the checklist once, at the first message; buttons create topics and ask the Lead", { skip: needs("web") }, async () => {
	const t = testDirector();
	await t.s.commands.dispatch(t.text("hello"));
	const list = t.tg.said.find((s) => s.text.startsWith("🧭"))!;
	assert.match(list.text, /▫️ Topics: 0 of \d+/);
	assert.match(list.text, /✅ Budget: \$/, "the test config's credit runs until a later date");
	assert.match(list.text, /➖ Home server \(optional\)/);
	assert.deepEqual(list.opts?.buttons?.map((r) => r[0]!.data), ["o:setup", "o:try", "o:routine"]);
	assert.equal(t.called("receive", "lead").length, 1, "the first message still reaches the Lead");
	await t.s.commands.dispatch(t.text("again"));
	assert.equal(t.tg.said.filter((s) => s.text.startsWith("🧭")).length, 1, "once by itself");

	await t.s.buttons.handle(t.tap("o:setup"));
	assert.ok(t.tg.calls.some((c) => c.method === "createForumTopic"));
	assert.match(t.tg.last().text, /✅ Topics: one per agent/);
	await t.s.buttons.handle(t.tap("o:try"));
	assert.match(String(t.called("receive", "lead").at(-1)!.args[1]), /Introduce the crew/);
	await t.s.buttons.handle(t.tap("o:nope"));
	assert.match(t.tg.answers.at(-1)!.text!, /step is gone/);
});

test("onboarding: an instance set up before it never shows it by itself; /start always does", async () => {
	const t = testDirector();
	t.sql("INSERT INTO topics VALUES ('research', 12)");
	const s = t.rebuild();
	await s.commands.dispatch(t.text("hello"));
	assert.equal(t.tg.said.filter((m) => m.text.startsWith("🧭")).length, 0);
	await s.commands.dispatch(t.text("/start"));
	assert.match(t.tg.last().text, /^🧭 Setting up/);
});

test("routines: moving one changes only its time, books the new run, and keeps the brief", { skip: needs("web") }, async () => {
	const t = testDirector(Date.UTC(2026, 9, 12, 5, 30)); // 07:30 local
	await t.s.routines.save("hf", "research", "15 7 * * *", "A long brief with details");
	const before = t.s.routines.get(1)!;
	assert.match(await t.s.routines.move(1, "15 4 * * *"), /moved from 15 7 \* \* \* to 15 4 \* \* \*.*next run 2026-10-13 04:15/);
	const after = t.s.routines.get(1)!;
	assert.equal(after.task, before.task);
	assert.equal(after.cron, "15 4 * * *");
	const booked = t.schedules.filter((s) => s.callback === "runRoutine");
	assert.equal(booked.length, 1);
	assert.equal((booked[0]!.payload as { cron: string }).cron, "15 4 * * *");
	assert.match(await t.s.routines.move(1, "nope"), /five-field/);
	assert.match(await t.s.routines.move(9, "0 4 * * *"), /No routine #9/);
	await t.s.commands.dispatch(t.text("/routines move 1 0 5 * * *"));
	assert.match(t.tg.last().text, /moved from 15 4 \* \* \* to 0 5 \* \* \*/);
});

test("news: a deploy's commits reach the Lead's instructions for a week, housekeeping left out", async () => {
	const t = testDirector();
	await t.s.fleet.shipped(["Routines move in place: move_routine for the Lead", "Board: C-054 covers releases"]);
	const [text, until] = t.called("setNews", "lead")[0]!.args as [string, number];
	assert.match(text, /^Shipped to the fleet this week/);
	assert.match(text, /Routines move in place: move_routine for the Lead/);
	assert.doesNotMatch(text, /Board/);
	assert.equal(until, t.ctx.now() + 7 * 86_400_000);
	await t.s.fleet.shipped(["Board: only housekeeping"]);
	assert.match(String(t.called("setNews", "lead")[1]!.args[0]), /Routines move in place/, "earlier news stays for its week");
});
