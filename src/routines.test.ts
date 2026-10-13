import assert from "node:assert/strict";
import { test } from "node:test";
import { cronMatches, cronProblem, localStamp, localTime, nextRun, routineBrief, utcCronToLocal } from "./routines.ts";

test("cronProblem accepts at most hourly five-field crons", () => {
	assert.equal(cronProblem("0 5 * * 1-5"), undefined);
	assert.equal(cronProblem("30 6,18 * * *"), undefined);
	assert.match(cronProblem("* 5 * * *")!, /minute as one number/);
	assert.match(cronProblem("*/5 * * * *")!, /minute as one number/);
	assert.match(cronProblem("61 5 * * *")!, /minute as one number/);
	assert.match(cronProblem("0 5 * *")!, /five-field.*Berlin/);
	assert.match(cronProblem("0 5 * * MON")!, /five-field/);
});

test("routineBrief names the routine so later runs find the earlier ones", () => {
	const brief = routineBrief({ id: 3, name: "morning-ai-news", task: "What happened in AI agents overnight?" }, Date.parse("2026-10-12T05:30:00Z"));
	assert.match(brief, /^Routine "morning-ai-news" \(routine #3\), scheduled run on Monday 2026-10-12 07:30 Berlin time\./);
	assert.match(brief, /library/);
	assert.ok(brief.endsWith("What happened in AI agents overnight?"));
});

const at = (iso: string) => Date.parse(iso);

test("routine crons are read in Berlin time and keep their wall-clock time when summer time ends", () => {
	// Summer time (UTC+2) until 2026-10-25 03:00 local, then UTC+1.
	assert.equal(localStamp(at("2026-10-11T05:30:00Z")), "2026-10-11 07:30");
	assert.equal(new Date(nextRun("30 7 * * *", at("2026-10-11T06:00:00Z"))!).toISOString(), "2026-10-12T05:30:00.000Z");
	assert.equal(new Date(nextRun("30 7 * * *", at("2026-10-25T00:00:00Z"))!).toISOString(), "2026-10-25T06:30:00.000Z");
	// Mondays 08:30: the 26th is the first Monday of winter time.
	assert.equal(new Date(nextRun("30 8 * * 1", at("2026-10-20T00:00:00Z"))!).toISOString(), "2026-10-26T07:30:00.000Z");
	assert.equal(nextRun("0 7 30 2 *", at("2026-10-11T00:00:00Z")), undefined, "no 30 February");
});

test("cronMatches handles lists, ranges, steps, Sunday as 7, and day-or-weekday", () => {
	const mon = localTime(at("2026-10-12T05:00:00Z")); // Monday 07:00
	assert.ok(cronMatches("0 7 * * 1-5", mon));
	assert.ok(cronMatches("0 6-8/1 * * 1,4", mon));
	assert.ok(!cronMatches("0 7 * * 0,6", mon));
	const sun = localTime(at("2026-10-11T05:00:00Z"));
	assert.ok(cronMatches("0 7 * * 7", sun));
	assert.ok(cronMatches("0 7 1 * 0", sun), "either the day or the weekday when both are set");
	assert.ok(cronMatches("0 */7 * * *", mon));
});

test("UTC crons move to the same Berlin wall-clock time; unusual ones stay as they are", () => {
	const summer = at("2026-10-11T08:00:00Z");
	assert.equal(utcCronToLocal("15 5 * * *", summer), "15 7 * * *");
	assert.equal(utcCronToLocal("0 7 * * 1,4", summer), "0 9 * * 1,4");
	assert.equal(utcCronToLocal("0 6,18 * * *", summer), "0 8,20 * * *");
	assert.equal(utcCronToLocal("0 23 * * 1", summer), "0 23 * * 1", "would cross midnight and change the weekday");
	assert.equal(utcCronToLocal("0 */6 * * *", summer), "0 */6 * * *");
	assert.equal(utcCronToLocal("15 5 * * *", at("2026-12-01T08:00:00Z")), "15 6 * * *");
});

test("the now line names the weekday, local time and offset, across the clock change", async () => {
	const { nowLine } = await import("./routines.ts");
	assert.equal(nowLine(Date.parse("2026-10-11T13:58:00Z")), "[Now: Sunday 2026-10-11 15:58, Europe/Berlin (UTC+02:00)]");
	assert.equal(nowLine(Date.parse("2026-10-26T08:00:00Z")), "[Now: Monday 2026-10-26 09:00, Europe/Berlin (UTC+01:00)]");
});
