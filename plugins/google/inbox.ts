// /inbox: the inbox one mail at a time, as a card (sender, subject, date, Gmail's preview) with buttons. Everything but
// Reply happens here at once, without a model: archive (with the <name>/archived trail), move to a label,
// important, tomorrow, and "always archive this sender" (a filter, after one more tap).
import { LABEL_PREFIX } from "../../src/google/allow.ts";
import type { SentStore } from "../../src/reactions.ts";
import { localStamp } from "../../src/routines.ts";
import type { Button } from "../../src/telegram.ts";
import type { Tap } from "../../src/director/buttons.ts";
import { type Ctx, general, Kv } from "../../src/director/context.ts";
import type { GoogleDesk } from "./desk.ts";
import type { Jobs } from "../../src/director/jobs.ts";
import type { Reminders } from "../../src/director/reminders.ts";
import type { PluginHost } from "../../src/plugin.ts";

export const inboxButtons = (id: string): Button[][] => [
	[{ text: "🗄 Archive", data: `i:a:${id}` }, { text: "✍️ Reply", data: `i:r:${id}` }, { text: "⏭ Skip", data: `i:s:${id}` }],
	[{ text: "📂 Move to…", data: `i:m:${id}` }, { text: "⭐ Important", data: `i:i:${id}` }, { text: "👀 Tomorrow", data: `i:t:${id}` }],
	[{ text: "🔁 Always archive this sender", data: `i:f:${id}` }],
];
/** Gmail's snippet arrives HTML-escaped. */
const unescape = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
type Headers = { payload?: { headers?: { name: string; value: string }[] } };
const header = (m: Headers, name: string) => (m.payload?.headers ?? []).find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";

export class Inbox {
	private readonly kv: Kv;
	private readonly ctx: Ctx;
	private readonly desk: GoogleDesk;
	private readonly jobs: Jobs;
	private readonly sent: SentStore;
	private readonly reminders: Reminders;
	constructor(host: PluginHost, desk: GoogleDesk) {
		this.ctx = host.ctx;
		this.desk = desk;
		this.jobs = host.jobs;
		this.sent = host.sent;
		this.reminders = host.reminders;
		this.kv = host.kv;
		host.buttons.register("i", (t) => this.tap(t));
		host.reminders.shows("inbox", (id) => this.card(id, "👀 From yesterday"));
		host.reactions.onHide.set("inbox", (s) => (s.gmail ? this.filterAsk(s.gmail) : Promise.resolve()));
		host.commands.register("inbox", (arg) => this.start(arg.trim() === "old" ? "old" : "new"));
	}

	private session(): { order: "new" | "old"; seen: string[] } {
		return this.kv.json("inbox_session", { order: "new", seen: [] });
	}
	private seen(id: string) {
		const s = this.session();
		s.seen = [...s.seen.slice(-499), id];
		this.kv.set("inbox_session", JSON.stringify(s));
	}

	async start(order: "new" | "old") {
		if (!(await this.ctx.google().status()).connected) return general(this.ctx, "Google is not connected: /google connect.");
		this.kv.set("inbox_session", JSON.stringify({ order, seen: [] }));
		return this.next();
	}

	/** The next inbox mail this round has not shown yet. */
	private async next() {
		const s = this.session();
		const list = await this.desk.gmail("GET", `/messages?${new URLSearchParams({ q: "in:inbox", maxResults: "500" })}`);
		const ids = ((list.messages ?? []) as { id: string }[]).map((m) => m.id);
		const ordered = s.order === "old" ? [...ids].reverse() : ids;
		const next = ordered.find((id) => !s.seen.includes(id));
		if (!next) return general(this.ctx, `📥 That's the inbox for this round: ${ids.length} left in it${s.seen.length ? `, ${s.seen.length} gone through` : ""}. /inbox starts again.`);
		return this.card(next, `📥 ${ids.length - s.seen.filter((x) => ids.includes(x)).length} to go`);
	}

	/** One mail as a card, read here without a model. */
	async card(id: string, head: string) {
		const m = (await this.desk.gmail("GET", `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)) as Headers & { labelIds?: string[]; snippet?: string };
		const when = Date.parse(header(m, "Date"));
		const star = (m.labelIds ?? []).includes("IMPORTANT") ? " ⭐" : "";
		const text = `${head}\n\n${header(m, "From")}${star}\n${header(m, "Subject") || "(no subject)"}\n${Number.isFinite(when) ? localStamp(when) : ""}\n\n${unescape(String(m.snippet ?? ""))}`;
		const sentId = await general(this.ctx, text, { buttons: inboxButtons(id) });
		if (sentId !== undefined) this.sent.note(sentId, { agent: "mail", kind: "inbox", gmail: id, text: `${header(m, "From")}: ${header(m, "Subject")}` });
	}

	/** "Always archive mail from …?", on the card itself when there is one. */
	async filterAsk(id: string, messageId?: number) {
		const from = header((await this.desk.gmail("GET", `/messages/${id}?format=metadata&metadataHeaders=From`)) as Headers, "From") || "this sender";
		const ask = `🔁 Archive all mail from ${from}, now and from now on? It stays in All Mail, labelled ${LABEL_PREFIX}archived; you remove the filter in Gmail's settings.`;
		const buttons = [[{ text: "✅ Yes, always", data: `i:F:${id}` }, { text: "No", data: `i:x:${id}` }]];
		if (messageId) await (await this.ctx.tg()).edit(messageId, ask, buttons);
		else await general(this.ctx, ask, { buttons });
	}

	private async tap({ action, arg, id: tap, messageId, done }: Tap) {
		const tg = await this.ctx.tg();
		const [id = "", labelId] = arg.split(":");
		if (action === "m" && messageId) {
			const labels = (((await this.desk.gmail("GET", "/labels")).labels ?? []) as { id: string; name: string; type: string }[])
				.filter((l) => l.type === "user" && !l.name.startsWith(LABEL_PREFIX))
				.sort((x, y) => x.name.localeCompare(y.name))
				.slice(0, 24);
			const rows: Button[][] = [];
			for (let i = 0; i < labels.length; i += 3) rows.push(labels.slice(i, i + 3).map((l) => ({ text: l.name.slice(0, 30), data: `i:M:${id}:${l.id}` })));
			rows.push([{ text: "« Back", data: `i:b:${id}` }]);
			await tg.edit(messageId, "📂 Move it to which label? It leaves the inbox.", rows);
			return tg.answer(tap);
		}
		if (action === "b" || action === "x") {
			if (messageId) await tg.edit(messageId, "📥 Back to this mail:", inboxButtons(id));
			await tg.answer(tap);
			if (action === "b") return this.card(id, "📥 This one again");
			return;
		}
		if (action === "f") return void (await this.filterAsk(id, messageId), await tg.answer(tap));
		if (action === "a") {
			await this.desk.gmail("POST", "/messages/batchModify", { ids: [id], removeLabelIds: ["INBOX"], addLabelIds: [await this.desk.archivedLabel()] });
			await done("Archived.");
		} else if (action === "M" && labelId) {
			await this.desk.gmail("POST", "/messages/batchModify", { ids: [id], removeLabelIds: ["INBOX"], addLabelIds: [labelId] });
			const name = ((await this.desk.gmail("GET", `/labels/${labelId}`)) as { name?: string }).name ?? "the label";
			await done(`Moved to ${name}.`);
		} else if (action === "i") {
			await this.desk.gmail("POST", "/messages/batchModify", { ids: [id], addLabelIds: ["IMPORTANT"] });
			await done("Marked important; it stays in the inbox.");
		} else if (action === "t") {
			this.reminders.tomorrow({ text: "", kind: "inbox", ref: id });
			await done("Back tomorrow at 09:00.");
		} else if (action === "r") {
			const answer = await this.jobs.create(
				`inbox:${tap}`,
				"mail",
				`The operator tapped "Reply" on message ${id} in /inbox. Read its thread (gmail_read), then draft a reply in that thread with gmail_draft, in the mail's language, from the right send-as address. Never send. Say in two lines what the draft says.`,
			);
			const started = /Job #(\d+)/.exec(answer)?.[1];
			await done(started ? `Mail is drafting a reply (job #${started}); it lands in Gmail Drafts.` : answer);
		} else if (action === "F") {
			const raw = header((await this.desk.gmail("GET", `/messages/${id}?format=metadata&metadataHeaders=From`)) as Headers, "From");
			const address = /<([^>]+)>/.exec(raw)?.[1] ?? raw.trim();
			if (!/^[^\s@]+@[^\s@]+$/.test(address)) return done("Could not read the sender's address; nothing changed.");
			const archived = await this.desk.archivedLabel();
			await this.desk.gmail("POST", "/settings/filters", { criteria: { from: address }, action: { addLabelIds: [archived], removeLabelIds: ["INBOX"] } });
			const now = ((await this.desk.gmail("GET", `/messages?${new URLSearchParams({ q: `from:${address} in:inbox`, maxResults: "500" })}`)).messages ?? []) as { id: string }[];
			if (now.length) await this.desk.gmail("POST", "/messages/batchModify", { ids: now.map((x) => x.id), removeLabelIds: ["INBOX"], addLabelIds: [archived] });
			await done(`Filter made: mail from ${address} skips the inbox from now on; ${now.length} archived now.`);
		} else if (action !== "s") return done("That button is from an older version.");
		else await done("Skipped.");
		this.seen(id);
		return this.next();
	}
}
