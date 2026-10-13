// What the Gmail tools share: the API base, the fleet's archived label, the answer shapes, and an Api bound to one
// agent (calls through the connector, label lookups, message ids from a list or a search, archive and restore).
import type { GoogleApi, GoogleResponse } from "../../../../src/google/connector.ts";
import { LABEL_PREFIX } from "../../../../src/google/allow.ts";
import type { Part } from "../mime.ts";

export const G = "https://gmail.googleapis.com/gmail/v1/users/me";
export const ARCHIVED = `${LABEL_PREFIX}archived`;
export const BATCH_MAX = 1000; // Gmail's batchModify limit, and the most one call moves
export const RELABEL_MAX = 5000; // five batchModify calls

export type Label = { id: string; name: string; type?: string; messagesTotal?: number; messagesUnread?: number };
export const isFleet = (name: string) => name.startsWith(LABEL_PREFIX);

export type Reply = { content: { type: "text"; text: string }[]; isError?: boolean };
export const reply = (t: string, isError = false): Reply => ({ content: [{ type: "text", text: t }], isError });

/** A failed request as the tool's answer. */
export const failure = (r: GoogleResponse): Reply => {
	const d = r.data as { error?: string | { message?: string } };
	const message = typeof d?.error === "string" ? d.error : (d?.error?.message ?? "unknown error");
	const hint = r.status === 403 && /scope/i.test(message) ? " The Google sign-in lacks this permission: the operator runs /google connect once more to grant it." : "";
	return reply(`Google refused (${r.status}): ${message}${hint}`, true);
};

export const labelName = (name: string) => (name.startsWith(LABEL_PREFIX) ? name : `${LABEL_PREFIX}${name.replace(/^\/+/, "")}`);

/** A message's attachments: every part with a file name, in order. */
export function attachmentParts(p: Part | undefined): Part[] {
	const out: Part[] = [];
	const walk = (part: Part) => {
		if (part.filename) out.push(part);
		for (const child of part.parts ?? []) walk(child);
	};
	if (p) walk(p);
	return out;
}

export type Api = ReturnType<typeof gmailApi>;

export function gmailApi(google: () => Promise<GoogleApi>, agent: string) {
	const call = async (method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown) => (await google()).request(agent, { method, url, body });

	/** Every label of the account, system ones included. */
	async function allLabels(): Promise<Label[] | Reply> {
		const r = await call("GET", `${G}/labels`);
		return r.ok ? ((r.data as { labels?: Label[] }).labels ?? []) : failure(r);
	}
	/** Exact label names (the operator's own or the fleet's) to ids; unknown names are an error, never created. */
	function idsOfNames(labels: Label[], names: readonly string[]): string[] | Reply {
		const byName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
		const missing = names.filter((n) => !byName.has(n.toLowerCase()));
		if (missing.length) return reply(`No label named ${missing.map((n) => `"${n}"`).join(", ")}. Create it first with gmail_label_create, or check gmail_labels for the exact name.`, true);
		return names.map((n) => byName.get(n.toLowerCase())!);
	}

	/** Label names to ids, creating the fleet's labels that do not exist yet. */
	async function labelIds(names: readonly string[], create: boolean): Promise<string[] | Reply> {
		const list = await call("GET", `${G}/labels`);
		if (!list.ok) return failure(list);
		const known = new Map(((list.data as { labels?: { id: string; name: string }[] }).labels ?? []).map((l) => [l.name, l.id]));
		const ids: string[] = [];
		for (const name of names.map(labelName)) {
			let id = known.get(name);
			if (!id && create) {
				const made = await call("POST", `${G}/labels`, { name, labelListVisibility: "labelShow", messageListVisibility: "show" });
				if (!made.ok) return failure(made);
				id = (made.data as { id: string }).id;
			}
			if (id) ids.push(id);
		}
		return ids;
	}

	/** Message ids from a list, or from a Gmail search (at most `max`). */
	async function idsFor(messages: readonly string[] | undefined, query: string | undefined, max: number): Promise<string[] | Reply> {
		if (messages?.length) return messages.slice(0, BATCH_MAX);
		if (!query) return reply("Give message ids or a Gmail search.", true);
		const ids: string[] = [];
		let page: string | undefined;
		do {
			const q = new URLSearchParams({ q: query, maxResults: String(Math.min(500, max - ids.length)) });
			if (page) q.set("pageToken", page);
			const r = await call("GET", `${G}/messages?${q}`);
			if (!r.ok) return failure(r);
			const d = r.data as { messages?: { id: string }[]; nextPageToken?: string };
			ids.push(...(d.messages ?? []).map((m) => m.id));
			page = d.nextPageToken;
		} while (page && ids.length < max);
		return ids;
	}

	/** Moves messages out of or back into the inbox, with the archived label as the trail. */
	async function move(ids: string[], archive: boolean): Promise<Reply> {
		if (!ids.length) return reply("No messages matched; nothing moved.");
		const label = await labelIds([ARCHIVED], true);
		if (!Array.isArray(label)) return label;
		const body = archive ? { ids, removeLabelIds: ["INBOX"], addLabelIds: label } : { ids, addLabelIds: ["INBOX"], removeLabelIds: label };
		const r = await call("POST", `${G}/messages/batchModify`, body);
		if (!r.ok) return failure(r);
		return reply(archive ? `Archived ${ids.length} message${ids.length === 1 ? "" : "s"} (labelled ${ARCHIVED}; undo with gmail_restore).` : `Moved ${ids.length} message${ids.length === 1 ? "" : "s"} back to the inbox.`);
	}

	return { call, allLabels, idsOfNames, labelIds, idsFor, move };
}
