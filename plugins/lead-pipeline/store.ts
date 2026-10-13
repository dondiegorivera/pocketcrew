// The lead pipeline's data, in the Director's SQLite (tables lp_*): offers (what the operator sells, its price), prospects
// (who might buy, found on the web, approved or not by the operator) and touches (the messages to them: day 0, 7, 21).
// Pure: the desk (desk.ts) and the tests use it; nothing here sends or schedules.
import type { Sql } from "../../src/sql.ts";

export type Offer = { id: number; name: string; pitch: string; price: number | null; suggestion: string | null; created: number };
export type Suggestion = { realistic: number; optimistic: number; floor: number; why: string };
export type ProspectStatus = "found" | "approved" | "rejected" | "replied" | "done";
export type Prospect = {
	id: number;
	offer: number;
	org: string;
	why: string;
	channel: Channel;
	contact: string;
	source: string;
	status: ProspectStatus;
	created: number;
	/** When the next touch is due (approved prospects only), or null when none is. */
	next_due: number | null;
	/** Touches sent so far. */
	sent: number;
};
export type Channel = "email" | "linkedin" | "form" | "other";
export const CHANNELS: Channel[] = ["email", "linkedin", "form", "other"];
export type Touch = { id: number; prospect: number; n: number; text: string; subject: string | null; status: "drafted" | "sent" | "skipped"; created: number };

const DAY = 86_400_000;
/** Day 0, 7 and 21: the first touch once approved, then two follow-ups, counted from the touch before. */
export const FOLLOW_UP_DAYS = [7, 14];
export const TOUCHES = FOLLOW_UP_DAYS.length + 1;

export function migrateLeads(sql: Sql) {
	sql(`CREATE TABLE IF NOT EXISTS lp_offers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, pitch TEXT NOT NULL, price INTEGER, suggestion TEXT, created INTEGER NOT NULL)`);
	sql(`CREATE TABLE IF NOT EXISTS lp_prospects (id INTEGER PRIMARY KEY AUTOINCREMENT, offer INTEGER NOT NULL, org TEXT NOT NULL, why TEXT NOT NULL, channel TEXT NOT NULL,
		contact TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, next_due INTEGER, sent INTEGER NOT NULL DEFAULT 0, UNIQUE (offer, org))`);
	sql(`CREATE TABLE IF NOT EXISTS lp_touches (id INTEGER PRIMARY KEY AUTOINCREMENT, prospect INTEGER NOT NULL, n INTEGER NOT NULL, text TEXT NOT NULL, subject TEXT,
		status TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE (prospect, n))`);
}

const orgKey = (org: string) => org.trim().toLowerCase().replace(/\s+/g, " ");

export class LeadStore {
	private readonly sql: Sql;
	constructor(sql: Sql) {
		this.sql = sql;
		migrateLeads(sql);
	}

	// ---- Offers ----

	addOffer(name: string, pitch: string, now: number): Offer {
		this.sql("INSERT INTO lp_offers (name, pitch, created) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET pitch = excluded.pitch", name.trim(), pitch.trim(), now);
		return this.offerByName(name)!;
	}
	offers(): Offer[] {
		return this.sql<Offer>("SELECT * FROM lp_offers ORDER BY id");
	}
	offer(id: number): Offer | undefined {
		return this.sql<Offer>("SELECT * FROM lp_offers WHERE id = ?", id)[0];
	}
	offerByName(name: string): Offer | undefined {
		return this.sql<Offer>("SELECT * FROM lp_offers WHERE lower(name) = lower(?)", name.trim())[0];
	}
	setPrice(id: number, price: number) {
		this.sql("UPDATE lp_offers SET price = ? WHERE id = ?", price, id);
	}
	suggest(id: number, s: Suggestion) {
		this.sql("UPDATE lp_offers SET suggestion = ? WHERE id = ?", JSON.stringify(s), id);
	}
	suggestionOf(o: Offer): Suggestion | undefined {
		return o.suggestion ? (JSON.parse(o.suggestion) as Suggestion) : undefined;
	}

	// ---- Prospects ----

	/** A prospect found on the web; one per organisation and offer. Answers why one was not added. */
	addProspect(p: { offer: number; org: string; why: string; channel: string; contact: string; source: string }, now: number): string {
		if (!this.offer(p.offer)) return `no offer #${p.offer}`;
		if (!CHANNELS.includes(p.channel as Channel)) return `channel must be one of ${CHANNELS.join(", ")}`;
		if (!/^https?:\/\//.test(p.source)) return "source must be the page where you found them (a URL)";
		const known = this.sql<{ id: number }>("SELECT id FROM lp_prospects WHERE offer = ? AND lower(org) = ?", p.offer, orgKey(p.org))[0];
		if (known) return `${p.org} is already prospect #${known.id}`;
		this.sql("INSERT INTO lp_prospects (offer, org, why, channel, contact, source, status, created) VALUES (?, ?, ?, ?, ?, ?, 'found', ?)", p.offer, p.org.trim(), p.why.trim(), p.channel, p.contact.trim(), p.source.trim(), now);
		return "";
	}
	prospect(id: number): Prospect | undefined {
		return this.sql<Prospect>("SELECT * FROM lp_prospects WHERE id = ?", id)[0];
	}
	prospects(status?: ProspectStatus): Prospect[] {
		return status ? this.sql<Prospect>("SELECT * FROM lp_prospects WHERE status = ? ORDER BY id", status) : this.sql<Prospect>("SELECT * FROM lp_prospects ORDER BY id");
	}
	/** The operator's verdict on a found prospect: approved ones get their first touch at once. */
	review(id: number, approve: boolean, now: number) {
		this.sql("UPDATE lp_prospects SET status = ?, next_due = ? WHERE id = ? AND status = 'found'", approve ? "approved" : "rejected", approve ? now : null, id);
	}
	/** They answered: no more follow-ups; the conversation is the operator's. */
	replied(id: number) {
		this.sql("UPDATE lp_prospects SET status = 'replied', next_due = NULL WHERE id = ?", id);
		this.sql("UPDATE lp_touches SET status = 'skipped' WHERE prospect = ? AND status = 'drafted'", id);
	}

	// ---- Touches ----

	/** Approved prospects whose next touch is due and not drafted yet, oldest first. */
	due(now: number, limit = 10): Prospect[] {
		return this.sql<Prospect>(
			`SELECT p.* FROM lp_prospects p WHERE p.status = 'approved' AND p.next_due IS NOT NULL AND p.next_due <= ?
			 AND NOT EXISTS (SELECT 1 FROM lp_touches t WHERE t.prospect = p.id AND t.n = p.sent) ORDER BY p.next_due LIMIT ?`,
			now,
			limit,
		);
	}
	/** The closer's draft of a prospect's next touch. Answers why it was not kept. */
	draft(prospect: number, text: string, subject: string | null, now: number): string {
		const p = this.prospect(prospect);
		if (!p || p.status !== "approved") return `prospect #${prospect} is not approved for outreach`;
		if (p.next_due === null || p.next_due > now) return `no touch is due for prospect #${prospect}`;
		this.sql("INSERT INTO lp_touches (prospect, n, text, subject, status, created) VALUES (?, ?, ?, ?, 'drafted', ?) ON CONFLICT (prospect, n) DO UPDATE SET text = excluded.text, subject = excluded.subject WHERE status = 'drafted'", prospect, p.sent, text.trim(), subject, now);
		return "";
	}
	touch(id: number): Touch | undefined {
		return this.sql<Touch>("SELECT * FROM lp_touches WHERE id = ?", id)[0];
	}
	drafted(): Touch[] {
		return this.sql<Touch>("SELECT * FROM lp_touches WHERE status = 'drafted' ORDER BY id");
	}
	/** The operator sent it: the next follow-up is due FOLLOW_UP_DAYS later, or the sequence is done. */
	sent(touchId: number, now: number) {
		const t = this.touch(touchId);
		if (!t || t.status !== "drafted") return;
		this.sql("UPDATE lp_touches SET status = 'sent' WHERE id = ?", touchId);
		const n = t.n + 1;
		const after = FOLLOW_UP_DAYS[t.n];
		this.sql("UPDATE lp_prospects SET sent = ?, next_due = ?, status = ? WHERE id = ?", n, after === undefined ? null : now + after * DAY, after === undefined ? "done" : "approved", t.prospect);
	}
	/** Not this one: the touch is dropped and the prospect's sequence ends. */
	skip(touchId: number) {
		const t = this.touch(touchId);
		if (!t || t.status !== "drafted") return;
		this.sql("UPDATE lp_touches SET status = 'skipped' WHERE id = ?", touchId);
		this.sql("UPDATE lp_prospects SET status = 'done', next_due = NULL WHERE id = ?", t.prospect);
	}
	history(prospect: number): Touch[] {
		return this.sql<Touch>("SELECT * FROM lp_touches WHERE prospect = ? AND status = 'sent' ORDER BY n", prospect);
	}
}

// ---- What the operator sees ----

export type LeadDecision = { kind: "prospect"; prospect: Prospect; offer: Offer } | { kind: "price"; offer: Offer } | { kind: "touch"; touch: Touch; prospect: Prospect; offer: Offer };

/** The decisions waiting, in the order /leads asks them: drafts to send first, then new prospects, then prices. */
export function decisions(s: LeadStore): LeadDecision[] {
	const offers = new Map(s.offers().map((o) => [o.id, o]));
	const touches = s.drafted().flatMap((touch) => {
		const prospect = s.prospect(touch.prospect);
		const offer = prospect && offers.get(prospect.offer);
		return prospect && offer ? [{ kind: "touch" as const, touch, prospect, offer }] : [];
	});
	const found = s.prospects("found").flatMap((prospect) => ((offer) => (offer ? [{ kind: "prospect" as const, prospect, offer }] : []))(offers.get(prospect.offer)));
	// An offer needs a price once someone is approved for it.
	const approved = new Set(s.prospects("approved").map((p) => p.offer));
	const prices = [...offers.values()].filter((o) => o.price === null && approved.has(o.id)).map((offer) => ({ kind: "price" as const, offer }));
	return [...touches, ...found, ...prices];
}

/** A decision's key, for "later" in one /leads session. */
export const decisionKey = (d: LeadDecision) => (d.kind === "touch" ? `t${d.touch.id}` : d.kind === "prospect" ? `p${d.prospect.id}` : `o${d.offer.id}`);

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export function decisionText(d: LeadDecision, left: number): string {
	const more = left > 1 ? `\n\n${left - 1} more after this.` : "";
	if (d.kind === "prospect")
		return `🎯 ${d.prospect.org} for ${d.offer.name}\n${d.prospect.why}\nReach: ${d.prospect.channel}${d.prospect.contact ? ` · ${d.prospect.contact}` : ""}\nFound: ${d.prospect.source}${more}`;
	if (d.kind === "price") {
		return `💲 ${d.offer.name} has no price, so no touch can name one.${((s) => (s ? `\nSuggested: realistic ${usd(s.realistic)}, optimistic ${usd(s.optimistic)}, floor ${usd(s.floor)}. ${s.why}` : ""))(d.offer.suggestion ? (JSON.parse(d.offer.suggestion) as Suggestion) : undefined)}${more}`;
	}
	const step = d.touch.n === 0 ? "First touch" : `Follow-up ${d.touch.n} of ${TOUCHES - 1}`;
	return `✉️ ${step} to ${d.prospect.org} (${d.prospect.channel}${d.prospect.contact ? `: ${d.prospect.contact}` : ""}) for ${d.offer.name}${d.touch.subject ? `\nSubject: ${d.touch.subject}` : ""}\n\n${d.touch.text}${more}`;
}

export type Btn = { text: string; data: string };
export function decisionButtons(d: LeadDecision, canDraftMail: boolean): Btn[][] {
	if (d.kind === "prospect") {
		const id = d.prospect.id;
		return [[{ text: "✅ Approve", data: `l:p${id}:yes` }, { text: "✖ Reject", data: `l:p${id}:no` }, { text: "Later", data: `l:p${id}:later` }]];
	}
	if (d.kind === "price") {
		const id = d.offer.id;
		const s = d.offer.suggestion ? (JSON.parse(d.offer.suggestion) as Suggestion) : undefined;
		return [
			...(s ? [[{ text: `Use ${usd(s.realistic)}`, data: `l:o${id}:use:realistic` }, { text: `Use ${usd(s.optimistic)}`, data: `l:o${id}:use:optimistic` }]] : []),
			[{ text: s ? "🔎 Suggest again" : "🔎 Suggest", data: `l:o${id}:suggest` }, { text: "Type a price", data: `l:o${id}:type` }, { text: "Later", data: `l:o${id}:later` }],
		];
	}
	const id = d.touch.id;
	return [
		[{ text: "✓ Sent", data: `l:t${id}:sent` }, ...(canDraftMail && d.prospect.channel === "email" ? [{ text: "📝 Gmail draft", data: `l:t${id}:gmail` }] : []), { text: "💬 They replied", data: `l:t${id}:replied` }],
		[{ text: "Skip, stop here", data: `l:t${id}:skip` }, { text: "Later", data: `l:t${id}:later` }],
	];
}

/** A typed price: 2500, $2,500, 2.5k. */
export function parseAmount(text: string): number | undefined {
	const m = /^\s*\$?\s*(\d[\d,.]*)\s*(k)?\s*(usd)?\s*$/i.exec(text);
	if (!m) return undefined;
	const n = Number(m[1]!.replace(/,/g, "")) * (m[2] ? 1000 : 1);
	return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}
