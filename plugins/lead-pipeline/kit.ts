// The lead pipeline's tools. They hold no data: each call goes to the plugin's part of the Director (desk.ts) with the
// calling agent's name, and the desk answers only the agent each call is for.
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";

type Call = (method: string, args: Record<string, unknown>) => Promise<unknown>;
const reply = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });

export const leadsKit = (call: Call): Extension =>
	defineExtension({
		name: "leads",
		tools: [
			defineTool({
				name: "leads_offers",
				description: "The operator's offers: what they sell and to whom (id, name, pitch). Prices are not shown here.",
				parameters: Type.Object({}),
				replay: "safe",
				execute: async () => reply(await call("offers", {})),
			}),
			defineTool({
				name: "leads_known",
				description: "Organisations already in the pipeline (any status), so you never add one twice.",
				parameters: Type.Object({ offer: Type.Optional(Type.Number({ description: "Only this offer's" })) }),
				replay: "safe",
				execute: async ({ offer }) => reply(await call("known", { offer })),
			}),
			defineTool({
				name: "leads_add",
				description: "Add one prospect you found for an offer. The operator reviews every one before anyone is contacted.",
				parameters: Type.Object({
					offer: Type.Number({ description: "The offer's id" }),
					org: Type.String({ description: "The organisation's name" }),
					why: Type.String({ description: "Two lines: why they fit now, from evidence on the source page" }),
					channel: Type.Union([Type.Literal("email"), Type.Literal("linkedin"), Type.Literal("form"), Type.Literal("other")]),
					contact: Type.String({ description: "The published business contact for that channel (a role address, a company page, a form URL), or empty. Never a guessed address" }),
					source: Type.String({ description: "The URL where you found the evidence" }),
				}),
				replay: "safe",
				execute: async (p) => reply(await call("add", p)),
			}),
			defineTool({
				name: "leads_due",
				description: "Approved prospects whose next touch is due, each with its offer (price included) and the touches already sent.",
				parameters: Type.Object({}),
				replay: "safe",
				execute: async () => reply(await call("due", {})),
			}),
			defineTool({
				name: "leads_draft",
				description: "Save the draft of a prospect's due touch. The operator sends it themselves and taps Sent; nothing is sent from here.",
				parameters: Type.Object({
					prospect: Type.Number(),
					text: Type.String({ description: "Exactly the message to send" }),
					subject: Type.Optional(Type.String({ description: "For email" })),
				}),
				replay: "safe",
				execute: async (a) => reply(await call("draft", a)),
			}),
			defineTool({
				name: "leads_suggest",
				description: "Save price suggestions for an offer, in whole US dollars: floor ≤ realistic ≤ optimistic, with why. The operator chooses.",
				parameters: Type.Object({ offer: Type.Number(), realistic: Type.Number(), optimistic: Type.Number(), floor: Type.Number(), why: Type.String({ description: "Two lines: the evidence it rests on" }) }),
				replay: "safe",
				execute: async (a) => reply(await call("suggest", a)),
			}),
		],
	});
