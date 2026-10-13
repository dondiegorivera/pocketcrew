// Labels: the fleet's triage labels and importance, archive and restore (always with the <name>/archived trail), and
// the operator's own label system (list with counts, create, rename, move mail between labels); never a delete.
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { LABEL_PREFIX } from "../../../../src/google/allow.ts";
import { type Api, ARCHIVED, BATCH_MAX, failure, G, isFleet, type Label, RELABEL_MAX, reply } from "./shared.ts";

export function labelTools({ call, allLabels, idsOfNames, labelIds, idsFor, move }: Api) {
	return [
		defineTool({
			name: "gmail_label",
			description: `Add or remove the fleet's labels (they live under ${LABEL_PREFIX}, which is added for you) on messages, and mark them important or not. Never archives or deletes.`,
			parameters: Type.Object({
				messages: Type.Array(Type.String(), { description: "Message ids" }),
				add: Type.Optional(Type.Array(Type.String(), { description: "Such as needs-reply, fyi, invoice, triaged" })),
				remove: Type.Optional(Type.Array(Type.String())),
				important: Type.Optional(Type.Boolean({ description: "true marks the messages important in Gmail, false clears the mark; leave out to keep it" })),
			}),
			replay: "safe",
			execute: async ({ messages, add, remove, important }) => {
				const addIds = await labelIds(add ?? [], true);
				if (!Array.isArray(addIds)) return addIds;
				const removeIds = await labelIds(remove ?? [], false);
				if (!Array.isArray(removeIds)) return removeIds;
				if (important !== undefined) (important ? addIds : removeIds).push("IMPORTANT");
				const r = await call("POST", `${G}/messages/batchModify`, { ids: messages, addLabelIds: addIds, removeLabelIds: removeIds });
				const mark = important === undefined ? "" : important ? ", marked important" : ", importance cleared";
				return r.ok ? reply(`Labels changed on ${messages.length} message${messages.length === 1 ? "" : "s"}${mark}.`) : failure(r);
			},
		}),
		defineTool({
			name: "gmail_labels",
			description: "List every label of the operator's Gmail with how many messages it holds and how many are unread, the operator's own and the fleet's (under " + LABEL_PREFIX + "), plus the inbox count. Start any label reorganisation here.",
			parameters: Type.Object({}),
			replay: "safe",
			execute: async () => {
				const labels = await allLabels();
				if (!Array.isArray(labels)) return labels;
				const counted = labels.filter((l) => l.type === "user" || l.id === "INBOX");
				const details: Label[] = [];
				for (let i = 0; i < counted.length; i += 10) {
					const part = await Promise.all(counted.slice(i, i + 10).map(async (l) => {
						const r = await call("GET", `${G}/labels/${l.id}`);
						return r.ok ? (r.data as Label) : l;
					}));
					details.push(...part);
				}
				const line = (l: Label) => `- ${l.name} · ${l.messagesTotal ?? "?"} message${l.messagesTotal === 1 ? "" : "s"}${l.messagesUnread ? ` (${l.messagesUnread} unread)` : ""}${l.messagesTotal === 0 ? " · empty" : ""}`;
				const sorted = details.sort((a, b) => a.name.localeCompare(b.name));
				const own = sorted.filter((l) => l.type === "user" && !isFleet(l.name));
				const fleet = sorted.filter((l) => isFleet(l.name));
				const inbox = sorted.find((l) => l.id === "INBOX");
				return reply([
					inbox ? `Inbox: ${inbox.messagesTotal ?? "?"} messages (${inbox.messagesUnread ?? 0} unread)` : "",
					`The operator's labels (${own.length}):`, ...own.map(line),
					`The fleet's labels (${fleet.length}):`, ...fleet.map(line),
				].filter(Boolean).join("\n"));
			},
		}),
		defineTool({
			name: "gmail_label_create",
			description: "Create labels in the operator's own label system, such as Money or Money/Invoices (a slash nests a label under another). Existing names are skipped. Only for a plan the operator approved.",
			parameters: Type.Object({ names: Type.Array(Type.String(), { description: "Full label names, such as Travel or Travel/Car" }) }),
			replay: "safe",
			execute: async ({ names }) => {
				const labels = await allLabels();
				if (!Array.isArray(labels)) return labels;
				const have = new Set(labels.map((l) => l.name.toLowerCase()));
				const made: string[] = [];
				for (const name of names.map((n) => n.trim()).filter(Boolean)) {
					if (isFleet(name)) return reply(`${LABEL_PREFIX} labels belong to the fleet and come with its tools.`, true);
					if (have.has(name.toLowerCase())) continue;
					// A nested name needs its parents.
					const parts = name.split("/");
					for (let i = 1; i <= parts.length; i++) {
						const n = parts.slice(0, i).join("/");
						if (have.has(n.toLowerCase())) continue;
						const r = await call("POST", `${G}/labels`, { name: n, labelListVisibility: "labelShow", messageListVisibility: "show" });
						if (!r.ok) return failure(r);
						have.add(n.toLowerCase());
						made.push(n);
					}
				}
				return reply(made.length ? `Created: ${made.join(", ")}.` : "All of them exist already; nothing created.");
			},
		}),
		defineTool({
			name: "gmail_label_rename",
			description: "Rename one of the operator's labels; labels nested under it move along (Old/X becomes New/X). Mail keeps its labels; nothing is deleted. Only for a plan the operator approved.",
			parameters: Type.Object({ from: Type.String({ description: "The label's exact current name" }), to: Type.String({ description: "The new full name" }) }),
			replay: "safe",
			execute: async ({ from, to }) => {
				const labels = await allLabels();
				if (!Array.isArray(labels)) return labels;
				const old = labels.find((l) => l.name.toLowerCase() === from.trim().toLowerCase() && l.type === "user");
				if (!old) return reply(`No label of the operator's named "${from}". Check gmail_labels.`, true);
				if (isFleet(old.name) || isFleet(to)) return reply(`${LABEL_PREFIX} labels belong to the fleet and are not renamed.`, true);
				if (labels.some((l) => l.name.toLowerCase() === to.trim().toLowerCase())) return reply(`"${to}" exists already. To merge, move the mail with gmail_relabel instead.`, true);
				const moved = [old, ...labels.filter((l) => l.name.startsWith(`${old.name}/`))];
				for (const l of moved) {
					const r = await call("PATCH", `${G}/labels/${l.id}`, { name: `${to.trim()}${l.name.slice(old.name.length)}` });
					if (!r.ok) return failure(r);
				}
				return reply(`Renamed "${old.name}" to "${to.trim()}"${moved.length > 1 ? `, with ${moved.length - 1} nested label${moved.length > 2 ? "s" : ""}` : ""}. Undo: rename it back.`);
			},
		}),
		defineTool({
			name: "gmail_relabel",
			description:
				"Move mail between the operator's labels in bulk: every message matching a Gmail search (or the given ids) gets the " +
				`labels in add and loses those in remove, by exact label name; archive also takes it out of the inbox (with ${ARCHIVED}). ` +
				`Use it to merge one label into another (search label:old, add new, remove old) or to file existing mail. At most ${RELABEL_MAX} messages a call. ` +
				"Look at a sample with gmail_search first; only for a plan the operator approved. It reports how to undo.",
			parameters: Type.Object({
				query: Type.Optional(Type.String({ description: 'A Gmail search, such as "label:domain-inquiries" or "from:wizzair.com"' })),
				messages: Type.Optional(Type.Array(Type.String(), { description: "Message ids instead of a search" })),
				add: Type.Optional(Type.Array(Type.String(), { description: "Exact label names to add" })),
				remove: Type.Optional(Type.Array(Type.String(), { description: "Exact label names to take off" })),
				archive: Type.Optional(Type.Boolean({ description: "Also take the mail out of the inbox" })),
				max: Type.Optional(Type.Integer({ description: `At most this many; default and limit ${RELABEL_MAX}` })),
			}),
			replay: "safe",
			execute: async ({ query, messages, add, remove, archive, max }) => {
				if (!add?.length && !remove?.length && !archive) return reply("Say what to add, remove or archive.", true);
				const labels = await allLabels();
				if (!Array.isArray(labels)) return labels;
				const addIds = idsOfNames(labels, add ?? []);
				if (!Array.isArray(addIds)) return addIds;
				const removeIds = idsOfNames(labels, remove ?? []);
				if (!Array.isArray(removeIds)) return removeIds;
				if (archive) {
					const trail = await labelIds([ARCHIVED], true);
					if (!Array.isArray(trail)) return trail;
					addIds.push(...trail);
					removeIds.push("INBOX");
				}
				const ids = messages?.length ? messages.slice(0, RELABEL_MAX) : await idsFor(undefined, query, Math.min(max ?? RELABEL_MAX, RELABEL_MAX));
				if (!Array.isArray(ids)) return ids;
				if (!ids.length) return reply("No messages matched; nothing changed.");
				for (let i = 0; i < ids.length; i += BATCH_MAX) {
					const r = await call("POST", `${G}/messages/batchModify`, { ids: ids.slice(i, i + BATCH_MAX), addLabelIds: addIds, removeLabelIds: removeIds });
					if (!r.ok) return failure(r);
				}
				const what = [add?.length ? `added ${add.join(", ")}` : "", remove?.length ? `removed ${remove.join(", ")}` : "", archive ? "archived" : ""].filter(Boolean).join("; ");
				const undo = [remove?.length ? `add ${remove.join(", ")}` : "", add?.length ? `remove ${add.join(", ")}` : ""].filter(Boolean).join(" and ");
				return reply(`${ids.length} message${ids.length === 1 ? "" : "s"}: ${what}.${ids.length === RELABEL_MAX ? ` That is the limit for one call: run it again for the rest.` : ""}${undo ? ` Undo: gmail_relabel on the same mail to ${undo}${archive ? ", then gmail_restore" : ""}.` : ""}`);
			},
		}),
		defineTool({
			name: "gmail_archive",
			description:
				"Move mail out of the inbox without deleting it: it stays in All Mail, searchable, with its labels, and gets " +
				`${ARCHIVED} so the operator can review or undo it. Give message ids, or a Gmail search such as ` +
				'"category:promotions older_than:14d" (only inbox mail is touched). Follow the inbox-rules skill for what may go.',
			parameters: Type.Object({
				messages: Type.Optional(Type.Array(Type.String(), { description: "Message ids" })),
				query: Type.Optional(Type.String({ description: "A Gmail search; in:inbox is added" })),
				max: Type.Optional(Type.Integer({ description: `At most this many; default and limit ${BATCH_MAX}` })),
			}),
			replay: "safe",
			execute: async ({ messages, query, max }) => {
				const ids = await idsFor(messages, query && `(${query}) in:inbox`, Math.min(max ?? BATCH_MAX, BATCH_MAX));
				return Array.isArray(ids) ? move(ids, true) : ids;
			},
		}),
		defineTool({
			name: "gmail_restore",
			description: `Move archived mail back into the inbox: by message ids, or a Gmail search such as "label:${LABEL_PREFIX.replace("/", "-")}archived from:bank" (only mail the fleet archived is touched).`,
			parameters: Type.Object({
				messages: Type.Optional(Type.Array(Type.String())),
				query: Type.Optional(Type.String()),
			}),
			replay: "safe",
			execute: async ({ messages, query }) => {
				const tag = ARCHIVED.replace("/", "-");
				const ids = await idsFor(messages, query && `(${query}) label:${tag}`, BATCH_MAX);
				return Array.isArray(ids) ? move(ids, false) : ids;
			},
		}),
	];
}
