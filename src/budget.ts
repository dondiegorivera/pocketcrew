// Pacing: spend the API credit evenly up to its expiry, so it is neither used up early nor left to lapse.
// Pure functions; the Director feeds them its ledger.
//
// Each day may use what was left at the start of the day spread over the days left, but never more than a multiple of
// the even pace (the credit as read, spread over its whole period), so credit saved up by quiet days cannot all land on
// one late day. What quiet days leave unspent is shown as "unspent beyond the even pace", and the Director spends it on
// the operator's wishlist (wishes.ts) instead of letting it lapse.

const DAY = 86_400_000;

export type Credit = {
	/** Credit left at `asOf`, in USD, as the Anthropic Console showed it. */
	usd: number;
	/** ISO time the `usd` figure was read. Spend before it is already inside the figure. */
	asOf: string;
	/** ISO time the credit expires (Console: "Expires on", UTC). */
	expires: string;
};

export type Allowance = {
	/** Credit left now: the Console figure minus what the fleet has spent since. */
	leftUsd: number;
	/** Whole or part days from the start of today (UTC) to expiry; at least 1. */
	daysLeft: number;
	/** Fleet budget for today: what was left at the start of today spread over the days left, capped at `capFactor` × the even pace. */
	todayUsd: number;
	spentTodayUsd: number;
	expired: boolean;
	/** The credit as read, spread over the days from that reading to expiry: what an even day costs. */
	evenDayUsd: number;
	/** How many even days one day may use: higher in the final week, when unspent credit would otherwise lapse. */
	capFactor: number;
	/** Left at the start of today minus what the even pace would have left: positive when quiet days saved credit up. */
	unspentUsd: number;
};

const DAY_CAP = 1.5;
const FINAL_WEEK_CAP = 2.5;
export const FINAL_WEEK_DAYS = 7;

export const startOfDayUtc = (t: number) => Math.floor(t / DAY) * DAY;

/**
 * @param spentSinceAsOf fleet spend recorded after `credit.asOf`
 * @param spentToday fleet spend recorded since the start of today (UTC), also counted in spentSinceAsOf
 */
export function allowance(credit: Credit, now: number, spentSinceAsOf: number, spentToday: number): Allowance {
	const expires = Date.parse(credit.expires);
	const leftUsd = Math.max(0, credit.usd - spentSinceAsOf);
	const expired = now >= expires;
	const daysLeft = Math.max(1, (expires - startOfDayUtc(now)) / DAY);
	const leftAtDayStart = leftUsd + spentToday;
	const evenDayUsd = credit.usd / Math.max(1, (expires - startOfDayUtc(Date.parse(credit.asOf))) / DAY);
	const capFactor = daysLeft <= FINAL_WEEK_DAYS ? FINAL_WEEK_CAP : DAY_CAP;
	const todayUsd = expired ? 0 : Math.min(leftAtDayStart, leftAtDayStart / daysLeft, evenDayUsd * capFactor);
	const unspentUsd = expired ? 0 : leftAtDayStart - evenDayUsd * daysLeft;
	return { leftUsd, daysLeft, todayUsd, spentTodayUsd: spentToday, expired, evenDayUsd, capFactor, unspentUsd };
}

/**
 * Whether credit is spare enough to start a wish: more than a day's even pace saved up, or any in the final week, when
 * whatever stays unspent lapses at expiry.
 */
/** Wishes start once a quarter of a day's pace is saved up (any saving in the final week), so credit is not left to lapse. */
export const WISH_THRESHOLD = 0.25;
export const spareForWishes = (a: Allowance) => !a.expired && a.unspentUsd > (a.daysLeft <= FINAL_WEEK_DAYS ? 0 : a.evenDayUsd * WISH_THRESHOLD);

/** Headroom over its share an agent may use on a day the others are quiet; the fleet total still binds. */
export const BURST = 2;

/**
 * What the operator lifted for today: nothing, the per-agent caps, or also the fleet's day limit. Never the expiry or
 * the reserve. Lifting the day limit only spends unused credit earlier: tomorrow's limit is recomputed from what is left.
 */
export type Lift = "none" | "agents" | "all";

/** An agent's cap for today. */
export const agentCap = (a: Allowance, share: number) => a.todayUsd * share * BURST;

/**
 * Why `agent` may not start work now, or undefined. `reserveUsd` is held back so the last cents of a credit never
 * turn into a bill on the card behind it.
 */
export function refusal(a: Allowance, share: number, agentSpentToday: number, reserveUsd: number, lift: Lift = "none"): string | undefined {
	if (a.expired) return "The API credit has expired. Send /credit <usd> <expiry> when a new grant arrives.";
	if (a.leftUsd <= reserveUsd) return `The API credit is used up ($${a.leftUsd.toFixed(2)} left, held in reserve).`;
	if (lift !== "all" && a.spentTodayUsd >= a.todayUsd)
		return `Today's fleet budget is used ($${a.spentTodayUsd.toFixed(2)} of $${a.todayUsd.toFixed(2)}). It refills at midnight UTC; /budget lift all in General spends ahead for today.`;
	const mine = agentCap(a, share);
	if (lift === "none" && agentSpentToday >= mine)
		return `This agent's share of today's budget is used ($${agentSpentToday.toFixed(2)} of $${mine.toFixed(2)}). It refills at midnight UTC; /budget lift in General frees it for today.`;
}

/** Where the fleet stands against the even pace, in one line. */
export function paceLine(a: Allowance): string {
	if (a.expired) return "The credit has expired.";
	const n = Math.abs(a.unspentUsd);
	if (n < 0.01) return "On the even pace.";
	return a.unspentUsd > 0
		? `Unspent beyond the even pace: $${n.toFixed(2)}. ${spareForWishes(a) ? "The wishlist runs from it (/wishes)." : "The wishlist starts once it passes a quarter of a day's pace."}`
		: `Spent ahead of the even pace: $${n.toFixed(2)}. The coming days are a little smaller to make up for it.`;
}

/** The arithmetic behind today's limit, in words, for /budget. */
export function explain(a: Allowance, credit: Credit, reserveUsd: number): string {
	const atStart = a.leftUsd + a.spentTodayUsd;
	const spread = atStart / a.daysLeft;
	const periodDays = credit.usd / a.evenDayUsd;
	return [
		`Even pace: $${credit.usd.toFixed(2)} read on ${credit.asOf.slice(0, 10)} ÷ ${periodDays.toFixed(1)} days to expiry = $${a.evenDayUsd.toFixed(2)} a day.`,
		`Today: $${atStart.toFixed(2)} left at the start of today ÷ ${a.daysLeft.toFixed(1)} days = $${spread.toFixed(2)}` +
			(spread > a.todayUsd + 1e-9 ? `, capped at ${a.capFactor}× the even pace: $${a.todayUsd.toFixed(2)}.` : `, under the cap of ${a.capFactor}× the even pace ($${(a.evenDayUsd * a.capFactor).toFixed(2)}).`),
		`The cap is ${DAY_CAP}× the even pace, ${FINAL_WEEK_CAP}× in the last ${FINAL_WEEK_DAYS} days. Each agent may use up to ${BURST}× its share of today's limit. $${reserveUsd.toFixed(0)} of the credit is never spent.`,
		"At midnight UTC the limit is recomputed from what is left, so a heavy day makes the following days a little smaller and the total never exceeds the credit.",
	].join("\n");
}
