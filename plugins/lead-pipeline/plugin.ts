// A small sales pipeline: the Prospector finds organisations that fit an offer on the web, the operator approves or
// rejects each in /leads, the Closer drafts a first touch and two follow-ups (day 0, 7, 21) for the approved ones, and
// the operator sends them and taps Sent. Prices: the operator's, or suggested in two stages (public evidence, then Opus
// without web). The data lives in the Director's storage: no repo or server needed.
// Safety: the Prospector reads the web and never sees prices or drafts; the Closer holds them and has no web and no way
// out; only the operator's approval moves a prospect from one to the other.
import { baseName } from "../../src/fleet.ts";
import { definePlugin } from "../../src/plugin.ts";
import { CLOSER, LeadDesk, PROSPECTOR } from "./desk.ts";

type Args = Record<string, unknown> & { agent?: string };
/** A desk call for one agent only: the tools are the agents', and the Director checks who asks. */
const only = <T>(agent: string, fn: (desk: LeadDesk, a: Args) => T) => (desk: LeadDesk, args: unknown) => {
	const a = (args ?? {}) as Args;
	return baseName(String(a.agent ?? "")) === agent ? fn(desk, a) : `only the ${agent} may do that`;
};

export default definePlugin<LeadDesk>({
	name: "lead-pipeline",
	about: "Prospects for what you sell, found on the web, approved by you, with drafted first touches and follow-ups.",
	// The Prospector searches and reads the web with its tools; Gmail drafts (google) are optional.
	requires: ["web"],
	agents: {
		[PROSPECTOR]: {
			title: "Prospector",
			role: "specialist",
			does: "finds organisations that fit one of the operator's offers, with evidence and a published contact channel, for the operator to approve in /leads; also gathers public price evidence",
			model: "claude-haiku-5-5",
			effort: "medium",
			tools: ["web_search", "web_fetch", "leads_offers", "leads_known", "leads_add", "publish_page", "read_skill"],
			mcp: [],
			share: 0.06,
			parallelJobs: 1,
			searchesPerJob: 10,
		},
		[CLOSER]: {
			title: "Closer",
			role: "specialist",
			does: "drafts the first touch and the day 7 and day 21 follow-ups for prospects the operator approved, and suggests prices from gathered evidence; never sends",
			model: "claude-sonnet-5-5",
			effort: "medium",
			tools: ["leads_due", "leads_draft", "leads_suggest", "read_skill"],
			mcp: [],
			share: 0.04,
			parallelJobs: 1,
			searchesPerJob: 0,
		},
	},
	tools: {
		leads_offers: { kit: "leads", risks: [] },
		leads_known: { kit: "leads", risks: [] },
		// Adds to a list only the operator's approval releases; not a way out of the fleet.
		leads_add: { kit: "leads", risks: [] },
		// Prices, contacts and what was said to whom.
		leads_due: { kit: "leads", risks: ["private"] },
		leads_draft: { kit: "leads", risks: [] },
		leads_suggest: { kit: "leads", risks: [] },
	},
	kits: {
		leads: async (h) =>
			(await import("./kit.ts")).leadsKit(async (method, args) => (await h.director()).pluginRpc("lead-pipeline", method, { ...args, agent: h.agent })),
	},
	director: (host) => new LeadDesk(host),
	tick: (desk) => desk.draftDue(),
	rpc: {
		offers: only(PROSPECTOR, (d) => d.offersForProspector()),
		known: only(PROSPECTOR, (d, a) => d.known(a.offer as number | undefined)),
		add: only(PROSPECTOR, (d, a) => d.add(a as never)),
		due: only(CLOSER, (d) => d.due()),
		draft: only(CLOSER, (d, a) => d.draft(a as never)),
		suggest: only(CLOSER, (d, a) => d.suggest(a as never)),
	},
	help: [
		"/leads: the lead pipeline's next decision (approve a prospect, send a touch, set a price), with buttons",
		"/leads offer <name> | <pitch> · /leads find <offer> [where to look] · /leads list",
	],
});
