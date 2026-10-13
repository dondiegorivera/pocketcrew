// /leads: the lead pipeline's decisions one at a time with buttons (store.ts holds the data and the formats), offers,
// typed prices, the two-stage price suggestion, and the touches: every tick, due touches go to the Closer as one job,
// and its drafts come back here for the operator to send. The fleet never sends; "✓ Sent" is the operator's word.
import type { Tap } from "../../src/director/buttons.ts";
import { type Ctx, general, type Kv } from "../../src/director/context.ts";
import type { Finished, Jobs } from "../../src/director/jobs.ts";
import { FLEET } from "../../src/fleet.ts";
import type { PluginHost } from "../../src/plugin.ts";
import { decisionButtons, decisionKey, decisions, decisionText, LeadStore, parseAmount, type Suggestion } from "./store.ts";

export const PROSPECTOR = "prospector";
export const CLOSER = "closer";

type Session = { later: string[] };

export class LeadDesk {
	readonly store: LeadStore;
	private readonly ctx: Ctx;
	private readonly kv: Kv;
	private readonly jobs: Jobs;
	constructor(host: PluginHost) {
		this.ctx = host.ctx;
		this.kv = host.kv;
		this.jobs = host.jobs;
		this.store = new LeadStore(host.ctx.sql);
		host.commands.register("leads", (arg) => this.command(arg));
		host.commands.interceptors.push((text) => this.typedPrice(text));
		host.buttons.register("l", (t) => this.tap(t));
		host.jobs.onDone("leads:", (f) => this.jobDone(f));
		host.digests.waiting.push(() => this.waitingLines());
	}

	private session(): Session {
		return this.kv.json<Session>("leads_session", { later: [] });
	}

	// ---- The operator ----

	/** /leads, /leads offer <name> | <pitch>, /leads find <offer> [where to look], /leads list */
	async command(arg: string) {
		const [verb = "", ...rest] = arg.trim().split(/\s+/);
		const text = rest.join(" ");
		if (verb === "offer") {
			const [name, pitch] = text.split("|").map((x) => x.trim());
			if (!name || !pitch) return general(this.ctx, "Usage: /leads offer <name> | <what it is and who it is for, in a sentence or two>");
			const o = this.store.addOffer(name, pitch, this.ctx.now());
			return general(this.ctx, `📦 Offer #${o.id} "${o.name}" saved. /leads find ${o.name} looks for prospects; its price is asked once you approve one.`);
		}
		if (verb === "find") return general(this.ctx, await this.find(text));
		if (verb === "list") return general(this.ctx, this.summary());
		if (verb) return general(this.ctx, "Usage: /leads (the next decision), /leads offer <name> | <pitch>, /leads find <offer> [where to look], /leads list");
		this.kv.set("leads_session", JSON.stringify({ later: [] }));
		return this.next();
	}

	/** The next decision with its buttons, or that there is none. */
	async next() {
		const later = new Set(this.session().later);
		const open = decisions(this.store).filter((d) => !later.has(decisionKey(d)));
		const d = open[0];
		if (!d) return general(this.ctx, later.size ? `🎯 That's all for now (${later.size} for later).` : "🎯 Nothing waits in the lead pipeline.");
		await general(this.ctx, decisionText(d, open.length), { buttons: decisionButtons(d, Object.hasOwn(FLEET, "mail")) });
	}

	private async tap({ id: tapId, action, arg, done }: Tap) {
		const kind = action[0];
		const id = Number(action.slice(1));
		if (arg === "later") {
			const s = this.session();
			s.later.push(action);
			this.kv.set("leads_session", JSON.stringify(s));
			await done("Later.");
			return this.next();
		}
		if (kind === "p") {
			const p = this.store.prospect(id);
			if (!p || p.status !== "found") return done("Already decided.");
			this.store.review(id, arg === "yes", this.ctx.now());
			await done(arg === "yes" ? "Approved: the Closer drafts the first touch." : "Rejected.");
			if (arg === "yes") await this.draftDue();
			return this.next();
		}
		if (kind === "o") {
			const o = this.store.offer(id);
			if (!o) return done("That offer is gone.");
			if (arg === "type") {
				this.kv.set("leads_price", JSON.stringify({ id, until: this.ctx.now() + 30 * 60_000 }));
				return done(`Send the price for ${o.name} in whole US dollars, like 2500.`);
			}
			if (arg === "suggest") {
				await done(await this.suggestPrice(id));
				return;
			}
			if (arg.startsWith("use:")) {
				const s = this.store.suggestionOf(o);
				const price = arg === "use:optimistic" ? s?.optimistic : s?.realistic;
				if (!price) return done("That suggestion is gone.");
				this.store.setPrice(id, price);
				await done(`$${price.toLocaleString("en-US")}: noted.`);
				await this.draftDue();
				return this.next();
			}
		}
		if (kind === "t") {
			const t = this.store.touch(id);
			if (!t || t.status !== "drafted") return done("Already handled.");
			if (arg === "sent") this.store.sent(id, this.ctx.now());
			else if (arg === "replied") this.store.replied(t.prospect);
			else if (arg === "skip") this.store.skip(id);
			else if (arg === "gmail") {
				const p = this.store.prospect(t.prospect)!;
				const answer = await this.jobs.create(
					`leads:gmail:${tapId}`,
					"mail",
					`The operator wants this lead-pipeline touch as a Gmail draft to ${p.contact || p.org}. Create it with gmail_draft exactly as written, from the operator's own address; never send. Say in one line that it is ready.\n\nSubject: ${t.subject ?? ""}\n\n${t.text}`,
				);
				return done(/Job #\d+/.test(answer) ? "Mail drafts it in Gmail; tap ✓ Sent on the next /leads once you have sent it." : answer);
			}
			const notes: Record<string, string> = { sent: "Sent: the next follow-up is scheduled.", replied: "They replied: no more follow-ups; over to you.", skip: "Skipped: no more touches to them." };
			await done(notes[arg] ?? "Done.");
			return this.next();
		}
		return done("That button is out of date; /leads shows the current decisions.");
	}

	/** A price typed after "Type a price". */
	async typedPrice(text: string): Promise<boolean> {
		const waiting = this.kv.json<{ id: number; until: number } | null>("leads_price", null);
		if (!waiting || waiting.until < this.ctx.now()) return false;
		const price = parseAmount(text);
		const o = this.store.offer(waiting.id);
		if (price === undefined || !o) return false;
		this.kv.set("leads_price", "null");
		this.store.setPrice(o.id, price);
		await general(this.ctx, `💲 ${o.name}: $${price.toLocaleString("en-US")}, noted.`, { silent: true });
		await this.draftDue();
		await this.next();
		return true;
	}

	// ---- Jobs ----

	/** A Prospector job for an offer, with where to look if the operator said. */
	async find(text: string): Promise<string> {
		const o = this.store.offers().find((x) => text.toLowerCase().startsWith(x.name.toLowerCase()));
		if (!o) return `Which offer? ${this.store.offers().map((x) => x.name).join(", ") || "None yet: /leads offer <name> | <pitch>"}`;
		const hint = text.slice(o.name.length).trim();
		const answer = await this.jobs.create(
			`leads:find:${this.ctx.now()}`,
			PROSPECTOR,
			`Find prospects for offer #${o.id} "${o.name}" (leads_offers has its pitch), following the prospecting skill.${hint ? ` The operator adds: ${hint}` : ""} Add each with leads_add; report how many you added and the strongest three.`,
			undefined,
			["prospecting"],
		);
		return /Job #\d+/.test(answer) ? `🔎 ${answer} New prospects show up in /leads.` : answer;
	}

	/** Every tick, and after an approval or a price: due touches go to the Closer, one job at a time. */
	async draftDue(): Promise<void> {
		if (this.jobs.withKey("leads:draft:", ["queued", "running"]).length) return;
		const due = this.store.due(this.ctx.now()).filter((p) => this.store.offer(p.offer)?.price !== null);
		if (!due.length) return;
		await this.jobs.create(
			`leads:draft:${this.ctx.now()}`,
			CLOSER,
			`Draft the due touches, following the outreach-touches skill: leads_due lists them with their offer, price and earlier touches; save each with leads_draft. Report one line per draft.`,
			undefined,
			["outreach-touches"],
		);
	}

	/** Price suggestions in two jobs: the Prospector gathers public evidence (never the operator's price), then the
	 * Closer, on Opus and without web, weighs it and saves a realistic, an optimistic and a floor price. */
	async suggestPrice(offerId: number): Promise<string> {
		const o = this.store.offer(offerId)!;
		if (this.jobs.withKey(`leads:price:${offerId}:`, ["queued", "running"]).length) return "Already researching that price.";
		const answer = await this.jobs.create(
			`leads:price:${offerId}:comps`,
			PROSPECTOR,
			`Stage 1 of the offer-pricing skill for offer #${o.id} "${o.name}" (leads_offers has its pitch): public evidence of what comparable things sell for. Report the evidence with sources; no price of your own.`,
			undefined,
			["offer-pricing"],
		);
		return /Job #\d+/.test(answer) ? "Gathering evidence, then Opus suggests; I'll say when it's in /leads." : answer;
	}

	private async jobDone({ job, status }: Finished) {
		const key = job.key;
		if (key.startsWith("leads:draft:")) {
			const n = this.store.drafted().length;
			if (status !== "done") return general(this.ctx, `⚠️ Drafting touches failed (job #${job.id}) · /trace ${CLOSER}`);
			return n ? general(this.ctx, `✉️ ${n} touch${n === 1 ? "" : "es"} ready to send · /leads`, { silent: true }) : undefined;
		}
		if (key.startsWith("leads:price:") && key.endsWith(":comps")) {
			if (status !== "done") return general(this.ctx, `⚠️ Price research stopped at the evidence step (job #${job.id}) · /trace ${PROSPECTOR}`);
			const offerId = Number(key.split(":")[2]);
			const o = this.store.offer(offerId);
			await this.jobs.create(
				key.replace(/:comps$/, ":suggest"),
				CLOSER,
				`Stage 2 of the offer-pricing skill for offer #${offerId} "${o?.name ?? ""}": the evidence is your input. Save a realistic, an optimistic and a floor price with leads_suggest, and say why in two lines.`,
				undefined,
				["offer-pricing"],
				"claude-opus-5-5",
				[job.id],
			);
			return;
		}
		if (key.startsWith("leads:price:")) {
			return general(this.ctx, status === "done" ? "💲 A price suggestion is ready · /leads" : `⚠️ The price suggestion failed (job #${job.id}) · /trace ${CLOSER}`, { silent: status === "done" });
		}
		if (key.startsWith("leads:find:") && status === "done") {
			const n = this.store.prospects("found").length;
			return n ? general(this.ctx, `🎯 ${n} prospect${n === 1 ? "" : "s"} to review · /leads`, { silent: true }) : undefined;
		}
		if (status !== "done") return general(this.ctx, `⚠️ Lead pipeline job #${job.id} (${job.agent}) failed · /trace ${job.agent}`);
	}

	// ---- The agents' tools (kit.ts), through the Director ----

	/** What the Prospector may see of the offers: names and pitches, never prices. */
	offersForProspector() {
		return this.store.offers().map((o) => ({ id: o.id, name: o.name, pitch: o.pitch }));
	}
	known(offer?: number) {
		return this.store.prospects().filter((p) => offer === undefined || p.offer === offer).map((p) => ({ id: p.id, offer: p.offer, org: p.org, status: p.status }));
	}
	add(p: { offer: number; org: string; why: string; channel: string; contact: string; source: string }) {
		return this.store.addProspect(p, this.ctx.now()) || "added";
	}
	/** For the Closer: due prospects with their offer (price included) and the touches already sent. */
	due() {
		return this.store.due(this.ctx.now()).map((p) => ({ prospect: p, offer: this.store.offer(p.offer), sent: this.store.history(p.id).map((t) => ({ n: t.n, subject: t.subject, text: t.text })) }));
	}
	draft(a: { prospect: number; text: string; subject?: string }) {
		return this.store.draft(a.prospect, a.text, a.subject ?? null, this.ctx.now()) || "saved; the operator sees it in /leads";
	}
	suggest(a: { offer: number } & Suggestion) {
		if (!this.store.offer(a.offer)) return `no offer #${a.offer}`;
		if (![a.floor, a.realistic, a.optimistic].every((n) => Number.isInteger(n) && n > 0) || !(a.floor <= a.realistic && a.realistic <= a.optimistic)) return "prices are whole dollars with floor ≤ realistic ≤ optimistic";
		this.store.suggest(a.offer, { realistic: a.realistic, optimistic: a.optimistic, floor: a.floor, why: a.why.slice(0, 400) });
		return "saved; the operator sees it in /leads";
	}

	// ---- Briefing ----

	summary(): string {
		const offers = this.store.offers();
		if (!offers.length) return "No offers yet: /leads offer <name> | <pitch>";
		const all = this.store.prospects();
		return offers
			.map((o) => {
				const mine = all.filter((p) => p.offer === o.id);
				const count = (s: string) => mine.filter((p) => p.status === s).length;
				return `📦 ${o.name}${o.price ? ` · $${o.price.toLocaleString("en-US")}` : " · no price"}: ${count("found")} to review, ${count("approved")} in outreach, ${count("replied")} replied, ${count("done") + count("rejected")} closed`;
			})
			.join("\n");
	}
	waitingLines(): string[] {
		const n = decisions(this.store).length;
		return n ? [`🎯 ${n} lead decision${n === 1 ? "" : "s"} waiting · /leads`] : [];
	}
}
