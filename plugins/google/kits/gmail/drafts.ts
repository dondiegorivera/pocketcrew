// Drafts: written into the operator's Gmail Drafts, in a thread when given, from a send-as address when asked. Never sent.
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { type GmailMessage, header, rawDraft } from "../mime.ts";
import { type Api, failure, G, type Reply, reply } from "./shared.ts";

export function draftTools({ call }: Api) {
/** The draft's From: the account's own address unless a configured send-as address is asked for. */
async function sender(from: string | undefined): Promise<string | undefined | Reply> {
	if (!from) return undefined;
	const r = await call("GET", `${G}/settings/sendAs`);
	if (!r.ok) return failure(r);
	const all = ((r.data as { sendAs?: { sendAsEmail: string; displayName?: string }[] }).sendAs ?? []);
	const match = all.find((s) => s.sendAsEmail.toLowerCase() === from.trim().toLowerCase());
	if (!match) return reply(`"${from}" is not a send-as address of this Gmail. Use one of: ${all.map((s) => s.sendAsEmail).join(", ")}.`, true);
	return match.displayName ? `${match.displayName} <${match.sendAsEmail}>` : match.sendAsEmail;
}

/** Headers that make a draft a reply in its thread. */
async function threading(thread: string | undefined): Promise<{ threadId?: string; inReplyTo?: string; references?: string } | Reply> {
	if (!thread) return {};
	const r = await call("GET", `${G}/threads/${thread}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`);
	if (!r.ok) return failure(r);
	const last = ((r.data as { messages?: GmailMessage[] }).messages ?? []).at(-1);
	const id = header(last?.payload, "Message-ID");
	return { threadId: thread, inReplyTo: id || undefined, references: [header(last?.payload, "References"), id].filter(Boolean).join(" ") || undefined };
}

const draftFields = {
	to: Type.String({ description: "Recipients, comma-separated" }),
	subject: Type.String(),
	body: Type.String({ description: "Plain text" }),
	cc: Type.Optional(Type.String()),
	from: Type.Optional(Type.String({ description: "A send-as address of this Gmail, such as the operator's own domain address; default: the account's own" })),
	thread: Type.Optional(Type.String({ description: "Thread id, to make the draft a reply in that thread" })),
};
type DraftArgs = { to: string; subject: string; body: string; cc?: string; from?: string; thread?: string };

async function message(args: DraftArgs): Promise<{ raw: string; threadId?: string } | Reply> {
	const from = await sender(args.from);
	if (from && typeof from !== "string") return from;
	const t = await threading(args.thread);
	if ("content" in t) return t;
	return { raw: rawDraft({ from, to: args.to, cc: args.cc, subject: args.subject, body: args.body, inReplyTo: t.inReplyTo, references: t.references }), ...(t.threadId ? { threadId: t.threadId } : {}) };
}

	return [
		defineTool({
			name: "gmail_draft",
			description: "Write a draft into the operator's Gmail Drafts. It is never sent: the operator reviews and sends it. Give a thread id to reply in a thread.",
			parameters: Type.Object(draftFields),
			replay: "safe",
			execute: async (args) => {
				const m = await message(args);
				if ("content" in m) return m;
				const r = await call("POST", `${G}/drafts`, { message: m });
				return r.ok ? reply(`Draft saved in Gmail Drafts (draft ${(r.data as { id: string }).id}). Nothing was sent.`) : failure(r);
			},
		}),
		defineTool({
			name: "gmail_update_draft",
			description: "Rewrite a draft the fleet wrote, by its draft id. Give the full new version; it is still never sent.",
			parameters: Type.Object({ draft: Type.String({ description: "Draft id" }), ...draftFields }),
			replay: "safe",
			execute: async ({ draft, ...args }) => {
				const m = await message(args);
				if ("content" in m) return m;
				const r = await call("PUT", `${G}/drafts/${draft}`, { id: draft, message: m });
				return r.ok ? reply(`Draft ${draft} updated. Nothing was sent.`) : failure(r);
			},
		}),
	];
}
