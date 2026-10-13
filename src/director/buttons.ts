// Taps on the fleet's buttons, routed by the prefix of their data (`m:`, `i:`, `r:`, `s:` …): each feature registers its
// own prefix. A tap answers the phone at once and, by default, notes the outcome under the message it came from.
import { buttonParts, type Update } from "../telegram.ts";
import type { Ctx } from "./context.ts";

export type Tap = {
	/** The callback id, also a unique key for a job a tap starts. */
	id: string;
	action: string;
	arg: string;
	messageId?: number;
	/** The tapped message's text. */
	text: string;
	/** Answers the tap with `note` and writes "→ note" under the message, dropping its buttons. */
	done: (note: string) => Promise<void>;
};
export type TapHandler = (tap: Tap) => Promise<unknown>;

export class Buttons {
	private readonly handlers = new Map<string, TapHandler>();
	private readonly ctx: Ctx;
	constructor(ctx: Ctx) {
		this.ctx = ctx;
	}

	register(prefix: string, handler: TapHandler) {
		if (this.handlers.has(prefix)) throw new Error(`button prefix "${prefix}" is taken`);
		this.handlers.set(prefix, handler);
	}

	async handle(cb: NonNullable<Update["callback_query"]>) {
		const tg = await this.ctx.tg();
		const [kind, action, arg] = buttonParts(cb.data ?? "");
		const msg = cb.message;
		const text = msg?.text ?? msg?.caption ?? "";
		const done = async (note: string) => {
			await tg.answer(cb.id, note);
			if (msg) await tg.edit(msg.message_id, `${text}\n\n→ ${note}`);
		};
		const handler = this.handlers.get(kind);
		if (!handler) return tg.answer(cb.id, "That button is from an older version.");
		try {
			await handler({ id: cb.id, action, arg, messageId: msg?.message_id, text, done });
		} catch (err) {
			console.error("button failed:", err);
			await tg.answer(cb.id, `⚠️ ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
