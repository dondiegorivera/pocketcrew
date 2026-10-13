import assert from "node:assert/strict";
import { test } from "node:test";
import { allowance, refusal } from "./budget.ts";

const credit = { usd: 99.93, asOf: "2026-10-10T11:30:00Z", expires: "2026-11-01T00:00:00Z" };
const at = (iso: string) => Date.parse(iso);

test("allowance spreads what is left over the days to expiry", () => {
	const a = allowance(credit, at("2026-10-10T12:00:00Z"), 0, 0);
	assert.equal(a.daysLeft, 22); // 10 Oct 00:00 to 1 Nov 00:00
	assert.ok(Math.abs(a.todayUsd - 99.93 / 22) < 1e-9);
	// A quiet stretch raises the later days: 9 days later with only $10 spent.
	const later = allowance(credit, at("2026-10-19T09:00:00Z"), 10, 0);
	assert.equal(later.daysLeft, 13);
	assert.ok(later.todayUsd > a.todayUsd);
});

test("today's spend counts against today's allowance but not against the day's starting balance", () => {
	const a = allowance(credit, at("2026-10-20T15:00:00Z"), 40, 3);
	assert.ok(Math.abs(a.todayUsd - (99.93 - 40 + 3) / 12) < 1e-9);
	assert.equal(a.spentTodayUsd, 3);
});

test("refusal holds the reserve, the fleet day, the agent share, and expiry", () => {
	const a = allowance(credit, at("2026-10-10T12:00:00Z"), 0, 0);
	assert.equal(refusal(a, 0.35, 0, 1), undefined);
	assert.match(refusal(a, 0.25, a.todayUsd * 0.25 * 2, 1)!, /share/);
	assert.match(refusal(allowance(credit, at("2026-10-10T12:00:00Z"), 5, 5), 1, 0, 1)!, /fleet budget/);
	assert.match(refusal(allowance(credit, at("2026-10-30T12:00:00Z"), 99.5, 0), 1, 0, 1)!, /used up/);
	assert.match(refusal(allowance(credit, at("2026-11-01T00:00:01Z"), 0, 0), 1, 0, 1)!, /expired/);
});

test("lifting: agents frees the per-agent caps, all also the day limit, never the reserve or expiry", async () => {
	const { refusal } = await import("./budget.ts");
	const a = { leftUsd: 90, todayUsd: 4.5, spentTodayUsd: 3, daysLeft: 20, expired: false } as Parameters<typeof refusal>[0];
	assert.match(refusal(a, 0.25, 2.3, 1)!, /share/);
	assert.equal(refusal(a, 0.25, 2.3, 1, "agents"), undefined);
	assert.match(refusal({ ...a, spentTodayUsd: 4.6 }, 0.25, 2.3, 1, "agents")!, /fleet budget/);
	assert.equal(refusal({ ...a, spentTodayUsd: 4.6 }, 0.25, 2.3, 1, "all"), undefined, "lift all: past the day limit");
	assert.match(refusal({ ...a, leftUsd: 0.9 }, 0.25, 2.3, 1, "all")!, /reserve/, "but never into the reserve");
	assert.match(refusal({ ...a, expired: true }, 0.25, 0, 1, "all")!, /expired/);
});

test("explain shows the arithmetic with the real numbers", async () => {
	const { explain } = await import("./budget.ts");
	const text = explain(allowance(credit, at("2026-10-10T18:00:00Z"), 4.72, 4.72), credit, 1);
	assert.match(text, /Even pace: \$99\.93 read on 2026-10-10 ÷ 22\.0 days to expiry = \$4\.54 a day/);
	assert.match(text, /\$99\.93 left at the start of today ÷ 22\.0 days = \$4\.54, under the cap of 1\.5×/);
	assert.match(text, /2× its share/);
});

test("saved-up credit is capped per day, more loosely in the final week, and shown as unspent", async () => {
	const { paceLine, spareForWishes } = await import("./budget.ts");
	const even = 99.93 / 22;
	// 15 quiet days, $10 spent: $89.93 left for 7 days would be $12.85 a day.
	const late = allowance(credit, at("2026-10-25T09:00:00Z"), 10, 0);
	assert.equal(late.daysLeft, 7);
	assert.ok(Math.abs(late.todayUsd - even * 2.5) < 1e-9, "final week: 2.5× the even pace");
	assert.ok(Math.abs(late.unspentUsd - (89.93 - even * 7)) < 1e-9);
	assert.ok(spareForWishes(late));
	// Mid-month: 1.5× cap, and wishes once a quarter of a day's pace is saved up.
	const mid = allowance(credit, at("2026-10-20T09:00:00Z"), 5, 0); // $94.93 ÷ 12 days = $7.91
	assert.ok(Math.abs(mid.todayUsd - even * 1.5) < 1e-9);
	assert.ok(spareForWishes(mid));
	assert.match(paceLine(mid), /Unspent beyond the even pace: \$\d+\.\d\d\. The wishlist runs/);
	const slight = allowance(credit, at("2026-10-12T09:00:00Z"), 99.93 / 22 * 2 - 0.5, 0);
	assert.ok(slight.unspentUsd > 0 && !spareForWishes(slight), "a few cents saved is not yet spare");
	const quarter = allowance(credit, at("2026-10-12T09:00:00Z"), 99.93 / 22 * 2 - 2, 0);
	assert.ok(spareForWishes(quarter), "more than a quarter day saved: wishes run");
	// Ahead of pace: the following days shrink, no wishes.
	const heavy = allowance(credit, at("2026-10-12T09:00:00Z"), 20, 0);
	assert.ok(heavy.unspentUsd < 0 && !spareForWishes(heavy));
	assert.match(paceLine(heavy), /Spent ahead of the even pace/);
	// The cap never lets the total exceed the credit: all days at their limit spend at most what is left.
	let left = 99.93;
	for (let d = 0; d < 22; d++) {
		const a = allowance(credit, Date.parse("2026-10-10T12:00:00Z") + d * 86_400_000, 99.93 - left, 0);
		left -= a.todayUsd;
	}
	assert.ok(left > -1e-9);
});
