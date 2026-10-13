// The credit and what it pays for: the spend ledger, today's allowance (budget.ts), who may start work now, the
// operator's /budget lift and /credit, and the nightly cost line.
import { agentCap, allowance, type Credit, explain, type Lift, paceLine, refusal, startOfDayUtc } from "../budget.ts";
import { type AgentName, baseName, CREDIT, FLEET, isAgentName, LIMITS, shareOf } from "../fleet.ts";
import { type Ctx, general, Kv, usd } from "./context.ts";

export class Spend {
	private readonly kv: Kv;
	private readonly ctx: Ctx;
	constructor(ctx: Ctx) {
		this.ctx = ctx;
		this.kv = new Kv(ctx.sql);
	}

	credit(): Credit {
		return this.kv.json<Credit>("credit", CREDIT);
	}

	spentSince(t: number, agent?: string): number {
		const row = agent
			? this.ctx.sql<{ s: number | null }>("SELECT SUM(usd) AS s FROM spend WHERE at >= ? AND agent = ?", t, agent)[0]
			: this.ctx.sql<{ s: number | null }>("SELECT SUM(usd) AS s FROM spend WHERE at >= ?", t)[0];
		return row?.s ?? 0;
	}

	allowanceNow() {
		const now = this.ctx.now();
		return allowance(this.credit(), now, this.spentSince(Date.parse(this.credit().asOf)), this.spentSince(startOfDayUtc(now)));
	}

	add(agent: string, model: string, amount: number) {
		this.ctx.sql("INSERT INTO spend VALUES (?, ?, ?, ?)", this.ctx.now(), agent, model, amount);
	}

	/**
	 * Why `who` (an agent, or a job worker `<agent>~<job>`) may not start work now, or undefined. Agents ask before each
	 * turn and each search. Wishes run on spare credit, so the agent's own cap does not bind them; the fleet's day does.
	 */
	check(who: string, wish = this.isWishWorker(who)): string | undefined {
		const agent = baseName(who);
		if (!isAgentName(agent)) return `Unknown agent ${agent}.`;
		const lift = this.liftToday();
		return refusal(this.allowanceNow(), shareOf(agent), this.spentSince(startOfDayUtc(this.ctx.now()), agent), LIMITS.reserveUsd, wish && lift === "none" ? "agents" : lift);
	}

	private isWishWorker(who: string): boolean {
		return who.includes("~") && this.ctx.sql("SELECT 1 FROM jobs WHERE worker = ? AND key LIKE 'wish:%' AND status = 'running'", who).length > 0;
	}

	/** What `/budget lift` lifted, if it was today (UTC). Stored as "<date>:<mode>"; a bare date is the agents mode. */
	liftToday(): Lift {
		const [date, mode] = (this.kv.get("lift") ?? "").split(":");
		if (date !== new Date(this.ctx.now()).toISOString().slice(0, 10)) return "none";
		return mode === "all" ? "all" : mode === "none" ? "none" : "agents";
	}

	/** `/budget lift [all|off]`; the caller starts queued jobs afterwards. */
	lift(arg: string): string {
		const mode: Lift = arg === "lift all" ? "all" : arg === "lift off" ? "none" : "agents";
		this.kv.set("lift", `${new Date(this.ctx.now()).toISOString().slice(0, 10)}:${mode}`);
		const said = {
			agents: "Per-agent caps are lifted until midnight UTC. The fleet's day limit still holds.",
			all: "Per-agent caps and today's fleet limit are lifted until midnight UTC. The credit and its $1 reserve still hold; the coming days' limits shrink to match.",
			none: "Today's limits apply again.",
		}[mode];
		return `${said}\n\n${this.text()}`;
	}

	/** `/budget`: the credit, today's numbers, the pace, caps per agent and how it is all worked out. */
	text(waitingWishes = 0): string {
		const a = this.allowanceNow();
		const c = this.credit();
		const since = startOfDayUtc(this.ctx.now());
		const rows = this.ctx.sql<{ agent: string; model: string; s: number }>("SELECT agent, model, SUM(usd) AS s FROM spend WHERE at >= ? GROUP BY agent, model ORDER BY s DESC", since);
		const lift = this.liftToday();
		return [
			`Credit: ${usd(a.leftUsd)} left of the ${usd(c.usd)} read on ${c.asOf.slice(0, 10)}, expires ${c.expires.slice(0, 10)} (${a.daysLeft.toFixed(1)} days).`,
			`Today: ${usd(a.spentTodayUsd)} of ${usd(a.todayUsd)} allowed.${lift === "all" ? " Lifted for today: everything but the reserve." : lift === "agents" ? " Lifted for today: per-agent caps." : ""}`,
			paceLine(a) + (waitingWishes ? ` ${waitingWishes} wish${waitingWishes > 1 ? "es" : ""} waiting.` : ""),
			...(rows.length ? ["", "Today by agent and model:", ...rows.map((r) => `- ${r.agent} · ${r.model}: ${usd(r.s)}`)] : []),
			"",
			"Per-agent caps today: " + (Object.keys(FLEET) as AgentName[]).map((n) => `${n} ${usd(agentCap(a, shareOf(n)))}`).join(", "),
			"",
			explain(a, c, LIMITS.reserveUsd),
			"/budget lift: no per-agent caps today · /budget lift all: also past today's limit · /budget lift off",
		].join("\n");
	}

	/** `/credit 85.20 2026-12-01`: the Console's remaining balance now, and when it expires. */
	setCredit(arg: string, waitingWishes = 0): string {
		const [amount, date] = arg.split(/\s+/);
		const value = Number(amount);
		const expires = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : undefined;
		if (!(value > 0) || !expires || Number.isNaN(Date.parse(expires))) return "Usage: /credit <usd left> <expiry YYYY-MM-DD>, as the Anthropic Console's Billing page shows them.";
		this.kv.set("credit", JSON.stringify({ usd: value, asOf: new Date(this.ctx.now()).toISOString(), expires } satisfies Credit));
		return `Credit set: $${value.toFixed(2)} until ${date}.\n${this.text(waitingWishes)}`;
	}

	/** 20:00 UTC: one quiet cost line for the day. */
	async nightly() {
		const a = this.allowanceNow();
		await general(this.ctx, `🧾 Today ${usd(a.spentTodayUsd)} of ${usd(a.todayUsd)} · ${usd(a.leftUsd)} credit left for ${Math.floor(a.daysLeft)} days · /budget for detail`, { silent: true });
	}

	/** A briefing line when the recorded credit is about to expire or has: each new grant has to be entered. */
	expiryLine(): string | undefined {
		const days = (Date.parse(this.credit().expires) - this.ctx.now()) / 86_400_000;
		if (days >= 7) return undefined;
		return days <= 0
			? "💳 The recorded credit has expired, so the fleet does not spend: /credit <usd> <YYYY-MM-DD> with the new grant."
			: `💳 The credit expires in ${Math.ceil(days)} day${Math.ceil(days) === 1 ? "" : "s"}: /credit <usd> <YYYY-MM-DD> when the next grant arrives.`;
	}
}
