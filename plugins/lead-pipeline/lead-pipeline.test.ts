import assert from "node:assert/strict";
import { test } from "node:test";
import { finish, testDirector } from "../../src/director/test-kit.ts";
import { FLEET } from "../../src/fleet.ts";
import { memorySql } from "../../src/test-sql.ts";
import type { LeadDesk } from "./desk.ts";
import plugin from "./plugin.ts";
import { decisions, LeadStore, parseAmount } from "./store.ts";

const DAY = 86_400_000;
const add = (s: LeadStore, offer: number, org: string, now = 0) => s.addProspect({ offer, org, why: "Launching an API", channel: "email", contact: "hello@acme.example", source: "https://acme.example/news" }, now);

test("store: one prospect per organisation, approval makes the first touch due, then day 7 and day 21, then done", () => {
	const s = new LeadStore(memorySql());
	const o = s.addOffer("Audit", "A security audit for API startups", 0);
	assert.equal(add(s, o.id, "Acme"), "");
	assert.match(add(s, o.id, " acme "), /already prospect/);
	assert.match(s.addProspect({ offer: o.id, org: "B", why: "x", channel: "fax", contact: "", source: "https://b.example" }, 0), /channel must be/);
	assert.match(s.addProspect({ offer: o.id, org: "B", why: "x", channel: "email", contact: "", source: "a forum" }, 0), /source must be/);
	const p = s.prospects("found")[0]!;
	assert.deepEqual(s.due(10), [], "nobody is contacted before the operator approves");
	s.review(p.id, true, 10);
	assert.equal(s.due(10).length, 1);
	assert.match(s.draft(p.id + 1, "hi", null, 10), /not approved/);
	assert.equal(s.draft(p.id, "First note", "An API audit", 10), "");
	assert.equal(s.due(10).length, 0, "a drafted touch is not due again");
	s.sent(s.drafted()[0]!.id, 100);
	assert.equal(s.prospect(p.id)!.next_due, 100 + 7 * DAY);
	assert.equal(s.due(100 + 6 * DAY).length, 0);
	s.draft(p.id, "Second", null, 100 + 7 * DAY);
	s.sent(s.drafted()[0]!.id, 100 + 7 * DAY);
	assert.equal(s.prospect(p.id)!.next_due, 100 + 21 * DAY, "the last follow-up on day 21");
	s.draft(p.id, "Last", null, 100 + 21 * DAY);
	s.sent(s.drafted()[0]!.id, 100 + 21 * DAY);
	assert.equal(s.prospect(p.id)!.status, "done");
	assert.equal(s.history(p.id).length, 3);
});

test("store: a reply stops the follow-ups; decisions come drafts first, then prospects, then prices", () => {
	const s = new LeadStore(memorySql());
	const o = s.addOffer("Audit", "pitch", 0);
	add(s, o.id, "Acme");
	add(s, o.id, "Beta");
	const [a, b] = s.prospects("found");
	s.review(a!.id, true, 0);
	assert.deepEqual(decisions(s).map((d) => d.kind), ["prospect", "price"], "an approved prospect makes the offer's price a question");
	s.draft(a!.id, "Hello", null, 0);
	assert.deepEqual(decisions(s).map((d) => d.kind), ["touch", "prospect", "price"]);
	s.replied(a!.id);
	assert.equal(s.prospect(a!.id)!.status, "replied");
	assert.equal(s.drafted().length, 0);
	s.review(b!.id, false, 0);
	assert.deepEqual(decisions(s), []);
	assert.deepEqual(["2500", "$2,500", "2.5k", "nope", "0"].map(parseAmount), [2500, 2500, 2500, undefined, undefined]);
});

test("/leads: offers, approval by tap, drafts by the Closer only once priced, Sent, and a price in two stages", async () => {
	const t = testDirector(undefined, [plugin]);
	const desk = t.s.plugin.part<LeadDesk>("lead-pipeline")!;
	await t.s.commands.dispatch(t.text("/leads offer Audit | A security audit for API startups"));
	assert.match(t.tg.last().text, /Offer #1 "Audit" saved/);
	await t.s.commands.dispatch(t.text("/leads find Audit fintechs in Berlin"));
	const find = t.s.jobs.withKey("leads:find:", ["running"])[0]!;
	assert.equal(find.agent, "prospector");

	// The tools, through the plugin's rpc, answer only the agent each is for; the Prospector never sees prices.
	assert.match(String(await t.s.plugin.rpc("lead-pipeline", "add", { agent: "closer~3", offer: 1, org: "X" })), /only the prospector/);
	assert.equal(await t.s.plugin.rpc("lead-pipeline", "add", { agent: "prospector~2", offer: 1, org: "Acme", why: "Raised a round for an API", channel: "email", contact: "hello@acme.example", source: "https://acme.example/news" }), "added");
	assert.deepEqual(await t.s.plugin.rpc("lead-pipeline", "offers", { agent: "prospector" }), [{ id: 1, name: "Audit", pitch: "A security audit for API startups" }]);
	await finish(t, find.id, "Added one.");
	assert.match(t.tg.last().text, /1 prospect to review/);

	await t.s.commands.dispatch(t.text("/leads"));
	assert.match(t.tg.last().text, /^🎯 Acme for Audit/);
	await t.s.buttons.handle(t.tap("l:p1:yes"));
	assert.equal(t.s.jobs.withKey("leads:draft:", ["running", "queued"]).length, 0, "no draft before the offer has a price");
	assert.match(t.tg.last().text, /^💲 Audit has no price/);

	await t.s.buttons.handle(t.tap("l:o1:type"));
	await t.s.commands.dispatch(t.text("4k"));
	assert.equal(t.called("receive", "lead").length, 0, "the typed price never reaches the Lead");
	const draft = t.s.jobs.withKey("leads:draft:", ["running"])[0]!;
	assert.equal(draft.agent, "closer");
	const due = (await t.s.plugin.rpc("lead-pipeline", "due", { agent: "closer~9" })) as { offer: { price: number } }[];
	assert.equal(due[0]!.offer.price, 4000);
	assert.match(String(await t.s.plugin.rpc("lead-pipeline", "due", { agent: "prospector" })), /only the closer/);
	await t.s.plugin.rpc("lead-pipeline", "draft", { agent: "closer", prospect: 1, text: "Saw your round...", subject: "Your API" });
	await finish(t, draft.id, "One draft.");
	assert.match(t.tg.last().text, /1 touch ready to send/);

	await t.s.commands.dispatch(t.text("/leads"));
	assert.match(t.tg.last().text, /^✉️ First touch to Acme \(email: hello@acme\.example\) for Audit\nSubject: Your API/);
	assert.equal(t.tg.last().opts?.buttons?.flat().some((b) => b.data === "l:t1:gmail"), Object.hasOwn(FLEET, "mail"), "Mail, when there is one, can put it in Gmail");
	await t.s.buttons.handle(t.tap("l:t1:sent"));
	assert.equal(desk.store.prospect(1)!.sent, 1);
	await t.s.buttons.handle(t.tap("l:t1:sent"));
	assert.match(t.tg.answers.at(-1)!.text!, /Already handled/);

	// Price suggestions: evidence on the web without the price, then Opus without the web.
	assert.match(await desk.suggestPrice(1), /Gathering evidence/);
	const comps = t.s.jobs.withKey("leads:price:1:", ["running"])[0]!;
	assert.equal(comps.agent, "prospector");
	await finish(t, comps.id, "evidence");
	const suggest = t.s.jobs.withKey("leads:price:1:suggest", ["running"])[0]!;
	assert.equal(t.s.jobs.get(suggest.id)!.model, "claude-opus-5-5");
	assert.match(String(await t.s.plugin.rpc("lead-pipeline", "suggest", { agent: "closer", offer: 1, realistic: 3000, optimistic: 2000, floor: 1000, why: "x" })), /floor ≤ realistic ≤ optimistic/);
	assert.match(String(await t.s.plugin.rpc("lead-pipeline", "suggest", { agent: "closer", offer: 1, realistic: 3000, optimistic: 5000, floor: 2000, why: "Three audits at 2.5-6k" })), /saved/);
	await finish(t, suggest.id, "suggested");
	assert.match(t.tg.last().text, /price suggestion is ready/);
});
