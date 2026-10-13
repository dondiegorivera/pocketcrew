// What reaches the phone on a schedule (digest.ts formats it): the 10:00 briefing (today's calendar, the routines, what
// waits on the operator, what broke, Mondays the routines nobody opens with stop buttons), a line per routine finishing
// after it, the 18:00 inbox line, /today, and the server sync's health. Features add briefing lines as providers.
import { BRIEFING_HOUR, BRIEFING_LATEST_HOUR, briefingText, type DoneJob, firstPage, INBOX_HOUR, inboxText, NIGHTLY_HOUR, localDay, routineIdOf, routineLine, todayText, UNREAD_DAYS, unreadRoutines } from "../digest.ts";
import { specialists } from "../fleet.ts";
import { localStamp, localTime, type Routine } from "../routines.ts";
import type { Button } from "../telegram.ts";
import type { Buttons, Tap } from "./buttons.ts";
import { type Ctx, general, Kv, usd } from "./context.ts";
import type { Finished, Jobs } from "./jobs.ts";
import type { Routines } from "./routines.ts";
import type { JobRow } from "./schema.ts";
import type { Spend } from "./spend.ts";

/** Lines for the briefing: what waits on the operator, or what broke. */
export type LineProvider = () => Promise<string[]> | string[];

export class Digests {
	private readonly kv: Kv;
	/** Lines right under the date (the google plugin: today's calendar). */
	readonly top: LineProvider[] = [];
	readonly waiting: LineProvider[] = [];
	readonly health: LineProvider[] = [];

	private readonly ctx: Ctx;
	private readonly jobs: Jobs;
	private readonly routines: Routines;
	private readonly spend: Spend;
	constructor(
		ctx: Ctx,
		jobs: Jobs,
		routines: Routines,
		spend: Spend,
		buttons: Buttons,
	) {
		this.ctx = ctx;
		this.jobs = jobs;
		this.routines = routines;
		this.spend = spend;
		this.kv = new Kv(ctx.sql);
		jobs.onDone("routine:", (f) => this.routineDone(f));
		// Jobs a button or a reaction started report back themselves.
		for (const prefix of ["button:", "inbox:", "react:"]) jobs.onDone(prefix, (f) => this.tapDone(f));
		buttons.register("r", (t) => this.routineTap(t));
		this.health.push(() => this.syncLines(), () => [this.spend.expiryLine()].filter((l): l is string => !!l), () => this.routines.failingTwice().map((r) => `⚠️ Routine "${r.name}" failed twice in a row · /trace ${r.agent}`));
	}

	/** A routine after today's briefing gets one line of its own; before it, it waits for the briefing. */
	private async routineDone({ job, needsOperator }: Finished) {
		if (this.kv.get("briefing_day") !== localDay(this.ctx.now())) return;
		await general(this.ctx, routineLine(this.routines.nameOf(job.key), job as DoneJob, specialists()), { silent: !needsOperator });
		this.kv.set("briefing_since", String(this.ctx.now()));
	}

	/** A job a button or a reaction started reports back itself, in one line. */
	private async tapDone({ job, status, title }: Finished) {
		await general(this.ctx, status === "done" ? `✓ ${title ?? `job #${job.id} done`}` : `⚠️ Job #${job.id} (${job.agent}) failed · /trace ${job.agent}`, { silent: status === "done" });
	}

	/** Once a day each: the morning briefing, the evening inbox line, the nightly cost line. Called every tick. */
	async run() {
		const now = this.ctx.now();
		const today = localDay(now);
		const t = localTime(now);
		if (t.hour >= BRIEFING_HOUR && this.kv.get("briefing_day") !== today) {
			const running = this.jobs.withKey("routine:", ["queued", "running"]);
			if (!running.length || t.hour >= BRIEFING_LATEST_HOUR) {
				const since = Number(this.kv.get("briefing_since") ?? now - 86_400_000);
				const done = this.jobs.withKey("routine:", ["done", "failed"]).filter((j) => (j.finished ?? 0) > since).sort((a, b) => (a.finished ?? 0) - (b.finished ?? 0));
				const unread = t.weekday === 1 ? await this.unread(now) : { lines: [], buttons: [] };
				const top = await this.collect(this.top);
				const extra = [...(await this.collect(this.waiting)), ...(await this.collect(this.health)), ...unread.lines];
				const text = briefingText(now, done.map((j) => ({ name: this.routines.nameOf(j.key), job: j })), running.map((j) => this.routines.nameOf(j.key)), specialists(), extra, top);
				this.kv.set("briefing_day", today);
				this.kv.set("briefing_since", String(now));
				if (text) await general(this.ctx, text, unread.buttons.length ? { buttons: unread.buttons } : undefined);
			}
		}
		if (t.hour >= INBOX_HOUR && this.kv.get("inbox_day") !== today) {
			const since = Number(this.kv.get("inbox_since") ?? now - 86_400_000);
			const jobs = this.jobs.withKey("mailwatch:", ["done", "failed"]).filter((j) => (j.finished ?? 0) > since).sort((a, b) => (a.finished ?? 0) - (b.finished ?? 0));
			this.kv.set("inbox_day", today);
			this.kv.set("inbox_since", String(now));
			const text = inboxText(jobs, specialists());
			if (text) await general(this.ctx, text, { silent: true });
		}
		if (t.hour >= NIGHTLY_HOUR && this.kv.get("nightly_day") !== today) {
			this.kv.set("nightly_day", today);
			await this.spend.nightly();
		}
	}

	private async collect(providers: readonly LineProvider[]): Promise<string[]> {
		const out: string[] = [];
		for (const p of providers) out.push(...(await Promise.resolve(p()).catch((err: unknown) => (console.error("briefing line failed:", err), []))));
		return out;
	}

	/** Routines whose pages went unopened for two weeks, counted from when the reports site began counting opens. */
	private async unread(now: number): Promise<{ lines: string[]; buttons: Button[][] }> {
		const since = Math.max(now - UNREAD_DAYS * 86_400_000, Number(this.kv.get("views_since") ?? now));
		const pathOf = (url: string) => {
			try {
				return decodeURIComponent(new URL(url).pathname.slice(1));
			} catch {
				return undefined;
			}
		};
		const runs = this.ctx.sql<JobRow>("SELECT * FROM jobs WHERE key LIKE 'routine:%' AND status = 'done' AND created > ?", since).flatMap((j) => {
			const id = routineIdOf(j.key);
			const r = id === undefined ? undefined : this.routines.get(id);
			const page = pathOf(firstPage(j.summary) ?? "");
			return r && page ? [{ routine: r.name, page }] : [];
		});
		if (!runs.length) return { lines: [], buttons: [] };
		const opened = new Set<string>(await this.ctx.library().pagesOpened([...new Set(runs.map((r) => r.page))]));
		const names = unreadRoutines(runs, opened);
		if (!names.length) return { lines: [], buttons: [] };
		const rows = names.map((n) => this.routines.byName(n)).filter((r): r is Routine => !!r);
		return {
			lines: [`📭 Not opened in two weeks: ${names.join(", ")}. Stop one below, or ignore this to keep it.`],
			buttons: rows.slice(0, 6).map((r) => [{ text: `⏹ Stop ${r.name}`, data: `r:s:${r.id}` }]),
		};
	}

	/** Stop a routine from the briefing, with one more tap to confirm: it has to be set up again to come back. */
	private async routineTap({ action, arg, id: tap, messageId, done }: Tap) {
		const id = Number(arg);
		const r = this.routines.get(id);
		if (!r) return done(`Routine #${id} is gone already.`);
		if (action === "s" && messageId) {
			const tg = await this.ctx.tg();
			await tg.edit(messageId, `Stop the routine "${r.name}"? It has to be set up again to come back.`, [[{ text: `⏹ Yes, stop ${r.name}`, data: `r:y:${id}` }, { text: "Keep it", data: `r:n:${id}` }]]);
			return tg.answer(tap);
		}
		if (action === "y") return done(await this.routines.cancel(id));
		return done(`Kept "${r.name}".`);
	}

	/** The server's sync reports after every full run; silence for two hours is a problem too. */
	syncReport(problems: string[]) {
		this.kv.set("sync_seen", String(this.ctx.now()));
		this.kv.set("sync_problems", JSON.stringify(problems.slice(0, 5)));
	}
	private syncLines(): string[] {
		const out: string[] = [];
		const seen = Number(this.kv.get("sync_seen") ?? 0);
		if (seen && this.ctx.now() - seen > 2 * 3_600_000) out.push(`⚠️ The server's sync has not reported since ${localStamp(seen)}: is the server up?`);
		for (const p of this.kv.json<string[]>("sync_problems", [])) out.push(`⚠️ Server sync: ${p.slice(0, 200)}`);
		return out;
	}

	/** /today: the day so far, in one message. */
	today(): string {
		const now = this.ctx.now();
		const t = localTime(now);
		const start = now - ((t.hour * 60 + t.minute) * 60_000 + (now % 60_000));
		const jobs = this.ctx.sql<DoneJob>("SELECT * FROM jobs WHERE created >= ? ORDER BY id", start);
		const a = this.spend.allowanceNow();
		return todayText(now, jobs, (key) => this.routines.nameOf(key), specialists(), `Spent ${usd(a.spentTodayUsd)} of ${usd(a.todayUsd)} allowed today · /budget`);
	}

	state() {
		return {
			syncSeen: Number(this.kv.get("sync_seen") ?? 0),
			syncProblems: this.kv.json<string[]>("sync_problems", []),
			briefingDay: this.kv.get("briefing_day") ?? null,
			inboxDay: this.kv.get("inbox_day") ?? null,
		};
	}
}
