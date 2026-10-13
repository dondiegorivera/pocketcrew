// Standing filters for new mail: list them, and create ones that only label, set importance or skip the inbox (with the
// archived trail). No forwarding, trash or spam; the fleet never deletes a filter.
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { type Api, ARCHIVED, failure, G, labelName, reply } from "./shared.ts";

export function filterTools({ call, labelIds }: Api) {
	return [
		defineTool({
			name: "gmail_filters",
			description: "List the standing Gmail filters: what each matches and what it does. The fleet's filters are the ones adding its labels.",
			parameters: Type.Object({}),
			replay: "safe",
			execute: async () => {
				const [r, labels] = await Promise.all([call("GET", `${G}/settings/filters`), call("GET", `${G}/labels`)]);
				if (!r.ok) return failure(r);
				const names = new Map(((labels.data as { labels?: { id: string; name: string }[] })?.labels ?? []).map((l) => [l.id, l.name]));
				const list = (r.data as { filter?: { id: string; criteria?: Record<string, unknown>; action?: { addLabelIds?: string[]; removeLabelIds?: string[]; forward?: string } }[] }).filter ?? [];
				if (!list.length) return reply("No filters.");
				return reply(
					list
						.map((f) => {
							const when = Object.entries(f.criteria ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(", ");
							const add = (f.action?.addLabelIds ?? []).filter((id) => id !== "IMPORTANT").map((id) => names.get(id) ?? id);
							const does = [add.length ? `label ${add.join(", ")}` : "", f.action?.addLabelIds?.includes("IMPORTANT") ? "mark important" : "", f.action?.removeLabelIds?.includes("IMPORTANT") ? "never important" : "", f.action?.removeLabelIds?.includes("INBOX") ? "skip inbox" : "", f.action?.forward ? `forward to ${f.action.forward}` : ""].filter(Boolean).join(", ");
							return `- ${when} → ${does || "nothing the fleet reads"}`;
						})
						.join("\n"),
				);
			},
		}),
		defineTool({
			name: "gmail_filter_create",
			description:
				"Create a standing Gmail filter for mail that arrives from now on: it adds the fleet's labels, may mark the mail " +
				"important (or never important), and may skip the inbox " +
				`(then it also adds ${ARCHIVED}, so the mail can be found and restored). No forwarding, trash or spam. Only when the ` +
				"operator asked for this rule or said yes to it. Filters touch new mail only: label existing mail with gmail_label. The " +
				"fleet cannot delete a filter; the operator removes one in Gmail's settings.",
			parameters: Type.Object({
				from: Type.Optional(Type.String({ description: "Sender address or domain" })),
				to: Type.Optional(Type.String()),
				subject: Type.Optional(Type.String()),
				query: Type.Optional(Type.String({ description: "Any Gmail search, such as list:news.example.com or has:attachment invoice" })),
				labels: Type.Array(Type.String(), { description: "Fleet labels to add, such as invoice or newsletter" }),
				skip_inbox: Type.Optional(Type.Boolean({ description: "Archive on arrival; only if the operator agreed" })),
				important: Type.Optional(Type.Boolean({ description: "true: always mark important; false: never mark important; leave out to let Gmail decide" })),
			}),
			replay: "safe",
			execute: async ({ from, to, subject, query, labels, skip_inbox, important }) => {
				const criteria = Object.fromEntries(Object.entries({ from, to, subject, query }).filter(([, v]) => v?.trim()));
				if (!Object.keys(criteria).length) return reply("Give at least one of from, to, subject or query: a filter without criteria would catch all mail.", true);
				if (!labels.length) return reply("Give at least one label.", true);
				const ids = await labelIds(skip_inbox ? [...labels, ARCHIVED] : labels, true);
				if (!Array.isArray(ids)) return ids;
				const removeIds = [...(skip_inbox ? ["INBOX"] : []), ...(important === false ? ["IMPORTANT"] : [])];
				const action = { addLabelIds: important ? [...ids, "IMPORTANT"] : ids, ...(removeIds.length ? { removeLabelIds: removeIds } : {}) };
				const r = await call("POST", `${G}/settings/filters`, { criteria, action });
				if (!r.ok) return failure(r);
				const when = Object.entries(criteria).map(([k, v]) => `${k}: ${v}`).join(", ");
				return reply(`Filter created: ${when} → label ${labels.map(labelName).join(", ")}${important === undefined ? "" : important ? ", mark important" : ", never important"}${skip_inbox ? ", skip inbox" : ""}. It applies to new mail.`);
			},
		}),
	];
}
