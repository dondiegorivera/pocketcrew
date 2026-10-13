// Telegram Bot API: the few calls the fleet makes, and the update shape it reads. `bot(env)` gives a client for the
// fleet's group, with the token and chat id from the secrets (secrets.ts); nothing else handles the token.
import { CONFIG } from "./config.ts";
import { localTime } from "./routines.ts";
import { secrets } from "./secrets.ts";

/** Night in the operator's zone (pocketcrew.config.ts quietHours, such as 22:00 to 07:00): messages still arrive, without a sound. */
export const quietHours = (ms = Date.now()) => quietAt(localTime(ms).hour);
/** Whether `hour` falls in the quiet range; a range may run past midnight (22 to 7) or not (13 to 15). */
export const quietAt = (hour: number, [from, until] = CONFIG.quietHours) => (from > until ? hour >= from || hour < until : hour >= from && hour < until);
/** A tap button under a message; `data` comes back in the callback (at most 64 bytes). */
export type Button = { text: string; data: string };
/**
 * How a message arrives: `silent` for what the operator reads later (reports, digests); otherwise it notifies, except at
 * night. `buttons`: rows of tap buttons under the (last part of the) message.
 */
export type SendOptions = { silent?: boolean; buttons?: Button[][] };
/** A button's data as kind, action and argument; the argument keeps any further colons (s:12:use:realistic). */
export function buttonParts(data: string): [kind: string, action: string, arg: string] {
	const [kind = "", action = "", ...rest] = data.split(":");
	return [kind, action, rest.join(":")];
}
const keyboard = (rows: Button[][]) => ({ inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data.slice(0, 64) }))) });

export type Update = {
	update_id: number;
	/** A tap on one of the bot's buttons. */
	callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number }; message_thread_id?: number; text?: string; caption?: string } };
	/** The operator reacted to a message (👍, 👎 …); needs the bot to be an admin of the group. */
	message_reaction?: { chat: { id: number }; message_id: number; user?: { id: number }; actor_chat?: { id: number }; new_reaction: { type: string; emoji?: string }[]; old_reaction?: { type: string; emoji?: string }[] };
	message?: {
		message_id: number;
		chat: { id: number; type: string };
		from?: { id: number; username?: string };
		voice?: import("./voice.ts").VoiceFile;
		audio?: import("./voice.ts").VoiceFile;
		document?: Document;
		/** The text sent with a file. */
		caption?: string;
		/** Set when an anonymous admin writes as the group. */
		sender_chat?: { id: number };
		message_thread_id?: number;
		is_topic_message?: boolean;
		text?: string;
	};
};

export type Document = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };

const MAX = 4096;
/** The Bot API's download limit. */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export async function tg<T = unknown>(token: string, method: string, body: object): Promise<T> {
	const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await res.json()) as { ok: boolean; result: T; description?: string };
	if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`); // never the URL: it holds the token
	return json.result;
}

/** Text in pieces Telegram accepts, split at line breaks where possible. */
export function chunks(text: string, max = MAX): string[] {
	const out: string[] = [];
	let rest = text;
	while (rest.length > max) {
		const cut = rest.lastIndexOf("\n", max);
		const at = cut > max / 2 ? cut : max;
		out.push(rest.slice(0, at));
		rest = rest.slice(at).replace(/^\n/, "");
	}
	if (rest.length || !out.length) out.push(rest);
	return out;
}

/** `/cmd@bot arg` → ["cmd", "arg"]; undefined for plain text. */
export function command(text: string): [string, string] | undefined {
	const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
	return m ? [m[1]!.toLowerCase(), (m[2] ?? "").trim()] : undefined;
}

/** The fleet's bot in the fleet's group. */
export class Bot {
	readonly token: string;
	readonly chat: string;

	constructor(token: string, chat: string) {
		this.token = token;
		this.chat = chat;
	}

	call<T = unknown>(method: string, body: object): Promise<T> {
		return tg<T>(this.token, method, body);
	}

	/** Sends to the group; `thread` undefined is the General topic. */
	/** Returns the id of the (last) message sent, so a tap or a reaction can be traced back to it. */
	async say(thread: number | undefined, text: string, opts: SendOptions = {}): Promise<number | undefined> {
		const silent = opts.silent || quietHours();
		const parts = chunks(text);
		let id: number | undefined;
		for (const [i, part] of parts.entries()) {
			const markup = opts.buttons && i === parts.length - 1 ? { reply_markup: keyboard(opts.buttons) } : {};
			id = (await this.call<{ message_id: number }>("sendMessage", { chat_id: this.chat, message_thread_id: thread, text: part, ...(silent ? { disable_notification: true } : {}), ...markup }))?.message_id;
		}
		return id;
	}

	/** Changes a sent message's text, and its buttons (none when `buttons` is empty). */
	async edit(messageId: number, text: string, buttons: Button[][] = []) {
		await this.call("editMessageText", { chat_id: this.chat, message_id: messageId, text: text.slice(0, MAX), reply_markup: keyboard(buttons) }).catch(() => undefined);
	}

	/** Ends a button's loading spinner, with a short note on the phone. */
	async answer(callbackId: string, text?: string) {
		await this.call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text: text.slice(0, 200) } : {}) }).catch(() => undefined);
	}

	typing(thread: number | undefined) {
		return this.call("sendChatAction", { chat_id: this.chat, message_thread_id: thread, action: "typing" }).catch(() => {});
	}

	/** Sends `content` as a file, so a long report reads as one document on the phone instead of many messages. */
	async sendFile(thread: number | undefined, filename: string, content: string, caption?: string, opts: SendOptions = {}): Promise<number | undefined> {
		const form = new FormData();
		form.set("chat_id", this.chat);
		if (opts.silent || quietHours()) form.set("disable_notification", "true");
		if (thread !== undefined) form.set("message_thread_id", String(thread));
		if (caption) form.set("caption", caption.slice(0, 1024));
		form.set("document", new Blob([content], { type: "text/markdown" }), filename);
		const res = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, { method: "POST", body: form });
		const json = (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
		if (!json.ok) throw new Error(`telegram sendDocument: ${json.description}`);
		return json.result?.message_id;
	}

	/** A file the operator sent, as bytes. Errors never include the download URL: it holds the token. */
	async download(fileId: string): Promise<ArrayBuffer> {
		const file = await this.call<{ file_path?: string }>("getFile", { file_id: fileId });
		if (!file.file_path) throw new Error("Telegram did not give me the file.");
		const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
		if (!res.ok) throw new Error(`Downloading the file failed (HTTP ${res.status}).`);
		return res.arrayBuffer();
	}
}

export async function bot(env: Env): Promise<Bot> {
	const s = await secrets(env, ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]);
	return new Bot(s.TELEGRAM_BOT_TOKEN, s.TELEGRAM_CHAT_ID);
}

/** The trust boundary: who the operator is, and the fleet's group. */
export type Trusted = { user: string; chat: string };

/** The operator, writing as themselves or as the group's anonymous admin (Telegram then sends the group as sender_chat). */
export const fromOperator = (m: NonNullable<Update["message"]>, ids: Trusted) => String(m.from?.id) === ids.user || (m.sender_chat !== undefined && String(m.sender_chat.id) === ids.chat);

/** A message that may reach an agent: the operator's, in the fleet's group. */
export const operatorMessage = (u: Update, ids: Trusted) => u.message !== undefined && String(u.message.chat.id) === ids.chat && fromOperator(u.message, ids);

/** A tap that counts: the operator's, on a message in the fleet's group. */
export const operatorTap = (u: Update, ids: Trusted) => !!u.callback_query && String(u.callback_query.from.id) === ids.user && String(u.callback_query.message?.chat.id) === ids.chat;

/**
 * The emoji the operator just added to a message in the fleet's group, or none. Only what was just added acts: taking a
 * reaction away, or a change that keeps it, does nothing again.
 */
export function operatorReactions(u: Update, ids: Trusted): string[] {
	const r = u.message_reaction;
	if (!r || String(r.chat.id) !== ids.chat) return [];
	if (!(String(r.user?.id) === ids.user || String(r.actor_chat?.id) === ids.chat)) return [];
	const before = new Set((r.old_reaction ?? []).map((x) => x.emoji ?? ""));
	return r.new_reaction.map((x) => x.emoji ?? "").filter((e) => e && !before.has(e));
}
