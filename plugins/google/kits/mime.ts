// Gmail's message format both ways: a fetched message as headers and plain text, and a draft as an RFC 2822 message.
import { htmlToText } from "../../web/web.ts";

export type Part = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: Part[] };
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part };

export const header = (p: Part | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

/** The readable text of a message: its text/plain part, else its HTML as text; attachments by name only. */
export function bodyText(p: Part | undefined): { text: string; attachments: string[] } {
	const attachments: string[] = [];
	let plain = "";
	let html = "";
	const walk = (part: Part) => {
		if (part.filename) attachments.push(part.filename);
		else if (part.mimeType === "text/plain" && part.body?.data && !plain) plain = decode(part.body.data);
		else if (part.mimeType === "text/html" && part.body?.data && !html) html = decode(part.body.data);
		for (const child of part.parts ?? []) walk(child);
	};
	if (p) walk(p);
	return { text: (plain || (html ? htmlToText(html) : "")).trim(), attachments };
}

/** One line per message for search results. */
export const messageLine = (m: GmailMessage) =>
	`${m.id} (thread ${m.threadId}) · ${header(m.payload, "Date")} · from ${header(m.payload, "From")} · ${header(m.payload, "Subject") || "(no subject)"}` +
	`${m.labelIds?.includes("UNREAD") ? " · unread" : ""}${m.labelIds?.includes("IMPORTANT") ? " · important" : ""}\n   ${(m.snippet ?? "").replace(/\s+/g, " ").slice(0, 200)}`;

// ---- Drafts ----

const encodedWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const noBreaks = (s: string) => s.replace(/[\r\n]+/g, " ").trim(); // a header value never starts a new header

export type Draft = { from?: string; to: string; cc?: string; subject: string; body: string; inReplyTo?: string; references?: string };

/** An RFC 2822 plain-text message, base64url-encoded as Gmail's `raw` wants it. */
export function rawDraft(d: Draft): string {
	const body = Buffer.from(d.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
	const lines = [
		...(d.from ? [`From: ${noBreaks(d.from)}`] : []),
		`To: ${noBreaks(d.to)}`,
		...(d.cc ? [`Cc: ${noBreaks(d.cc)}`] : []),
		`Subject: ${encodedWord(noBreaks(d.subject))}`,
		...(d.inReplyTo ? [`In-Reply-To: ${noBreaks(d.inReplyTo)}`, `References: ${noBreaks(d.references ?? d.inReplyTo)}`] : []),
		"MIME-Version: 1.0",
		'Content-Type: text/plain; charset="UTF-8"',
		"Content-Transfer-Encoding: base64",
		"",
		body,
	];
	return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}
