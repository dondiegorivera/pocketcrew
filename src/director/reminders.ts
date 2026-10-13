// "Tomorrow": something brought back at 09:00 the next morning. What comes back is up to the feature that asked: a
// plain text, or a kind with its own way of showing it again (a "Needs you" mail with its buttons, an /inbox card).
import { localTime } from "../routines.ts";
import { type Ctx, general, Kv } from "./context.ts";

/** `kind` with `ref` comes back through the shower registered for that kind; otherwise `text` is said in General. */
export type Reminder = { at: number; text: string; kind?: string; ref?: string };
type Stored = Reminder & { job?: number; gmail?: string }; // older entries named their reference by field

/** The next 09:00 local time after `now`, at least a few hours away. */
export const nextMorning = (now: number) => {
	const t = localTime(now);
	const hours = t.hour < 5 ? 9 - t.hour : 24 - t.hour + 9;
	return now - (t.minute * 60_000 + (now % 60_000)) + hours * 3_600_000;
};

export class Reminders {
	private readonly kv: Kv;
	private readonly showers = new Map<string, (ref: string, text: string) => Promise<unknown>>();
	private readonly ctx: Ctx;
	constructor(ctx: Ctx) {
		this.ctx = ctx;
		this.kv = new Kv(ctx.sql);
	}

	/** How a kind of reminder is shown again. */
	shows(kind: string, show: (ref: string, text: string) => Promise<unknown>) {
		this.showers.set(kind, show);
	}

	tomorrow(r: Omit<Reminder, "at">) {
		const list = this.kv.json<Stored[]>("reminders", []);
		list.push({ ...r, at: nextMorning(this.ctx.now()) });
		this.kv.set("reminders", JSON.stringify(list));
	}

	async due() {
		const now = this.ctx.now();
		const list = this.kv.json<Stored[]>("reminders", []);
		const due = list.filter((r) => r.at <= now);
		if (!due.length) return;
		this.kv.set("reminders", JSON.stringify(list.filter((r) => r.at > now)));
		for (const r of due) {
			const kind = r.kind ?? (r.gmail ? "inbox" : r.job ? "needsyou" : undefined);
			const ref = r.ref ?? r.gmail ?? (r.job !== undefined ? String(r.job) : undefined);
			const show = kind ? this.showers.get(kind) : undefined;
			if (show && ref) await show(ref, r.text);
			else await general(this.ctx, r.text);
		}
	}
}
