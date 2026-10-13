// pocketcrew on Cloudflare: Telegram arrives by webhook, passes the trust checks here, and goes to the Director,
// which routes it to an agent's Durable Object or runs a fleet command. The server's git sync reads the library here.
import { getAgentByName } from "agents";
import type { Director } from "./director.ts";
import { sameSecret } from "./secret.ts";
import { google } from "./google/connector.ts";
import { CALLBACK_PATH } from "./google/oauth.ts";
import { homePage, privacyPage } from "./public-pages.ts";
import { isSyncPath, syncExport } from "./sync-export.ts";
import { secret, secrets } from "./secrets.ts";
import { bot, operatorMessage, operatorReactions, operatorTap, type Update } from "./telegram.ts";

export { FleetAgent } from "./agent.ts";
export { Director } from "./director.ts";
export { Google } from "./google/connector.ts";
export { Library } from "./library-object.ts";
export { Repos } from "./repos-object.ts";

// Message kinds the operator sends that the fleet cannot read yet; service messages (a topic created, a pin) stay silent.
const MEDIA = ["photo", "video", "video_note", "sticker", "animation"];

type WebhookInfo = { url: string; pending_update_count: number; last_error_date?: number; last_error_message?: string };

/**
 * Points Telegram's webhook at this Worker with its current secret, and reports the webhook's state. Safe to expose:
 * it can only aim the bot at this same host with the secret it already holds, and its answer holds no secret.
 */
async function registerWebhook(env: Env, host: string) {
	const url = `https://${host}/telegram`;
	const b = await bot(env);
	// Always set: the secret may have been rotated, and Telegram never says which one it holds.
	await b.call("setWebhook", { url, secret_token: await secret(env, "TELEGRAM_WEBHOOK_SECRET", { fresh: true }), allowed_updates: ["message", "callback_query", "message_reaction"] });
	const info = await b.call<WebhookInfo>("getWebhookInfo", {});
	const { pending_update_count, last_error_date, last_error_message } = info;
	return Response.json({ url: info.url, pending_update_count, last_error_date, last_error_message });
}

const page = (title: string, text: string, status = 200) =>
	new Response(
		`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
			`<body style="font:17px/1.5 system-ui;margin:0;padding:32px 16px;max-width:520px;margin:auto"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body>`,
		{ status, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex", "referrer-policy": "no-referrer", "cache-control": "no-store" } },
	);

/** Google's redirect after sign-in. Only a state the Director handed out minutes ago is accepted, once. */
async function googleCallback(req: Request, env: Env): Promise<Response> {
	const q = new URL(req.url).searchParams;
	const [code, state] = [q.get("code"), q.get("state")];
	if (q.get("error") || !code || !state) return page("Not connected", "Google sign-in was cancelled. Send /google connect to try again.", 400);
	try {
		const email = await google(env).finish(code, state, `${env.PUBLIC_URL}${CALLBACK_PATH}`);
		await (await bot(env)).say(undefined, `✅ Google connected as ${email}. Mail, Calendar and Clerk can work now; new-mail triage starts within 15 minutes (/google watch off to stop it).`);
		return page("Connected", "Google is connected. You can close this page and go back to Telegram.");
	} catch (err) {
		return page("Not connected", err instanceof Error ? err.message.replace(/[<>&]/g, "") : "Something went wrong.", 400);
	}
}

export default {
	async fetch(req, env) {
		const { pathname, host } = new URL(req.url);
		if (req.method === "GET" && pathname === "/") return homePage();
		if (req.method === "GET" && pathname === "/privacy") return privacyPage();
		if (req.method === "GET" && pathname === "/telegram/webhook") return registerWebhook(env, host);
		if (isSyncPath(pathname)) return syncExport(req, env);
		if (req.method === "GET" && pathname === CALLBACK_PATH) return googleCallback(req, env);
		if (req.method !== "POST" || pathname !== "/telegram") return new Response("not found", { status: 404 });
		// Telegram echoes the secret given to setWebhook; anything else is not Telegram.
		const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
		const s = await secrets(env, ["TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_CHAT_ID", "TELEGRAM_USER_ID"]);
		// A mismatch may be a just-rotated secret still cached here: read it once more before refusing.
		if (!sameSecret(given, s.TELEGRAM_WEBHOOK_SECRET) && !sameSecret(given, await secret(env, "TELEGRAM_WEBHOOK_SECRET", { fresh: true }))) return new Response("forbidden", { status: 403 });
		const update = (await req.json()) as Update;
		const director = async () => getAgentByName(env.Director as DurableObjectNamespace<Director>, "main");
		// A button tap or a reaction counts only from the operator, on a message in the fleet's group.
		const ids = { user: s.TELEGRAM_USER_ID, chat: s.TELEGRAM_CHAT_ID };
		const cb = update.callback_query;
		if (cb) {
			if (operatorTap(update, ids)) await (await director()).button(cb);
			else await (await bot(env)).answer(cb.id);
			return new Response("ok");
		}
		if (update.message_reaction) {
			const added = operatorReactions(update, ids);
			if (added.length) await (await director()).reaction(update.message_reaction.message_id, added);
			return new Response("ok");
		}
		const m = update.message;
		// Trust boundary: only the operator, only in the fleet's group, reaches an agent.
		const ours = m !== undefined && operatorMessage(update, ids);
		if (ours && (m.text || m.voice || m.audio || m.document)) await (await director()).dispatch(update);
		// A photo, voice note or sticker from the operator: say so, instead of a silence that looks like a dead bot.
		else if (ours && MEDIA.some((k) => k in m)) await (await bot(env)).say(m.is_topic_message ? m.message_thread_id : undefined, "I can read text, voice notes and text files so far, not photos or videos.");
		else if (m) console.log(`ignored chat ${m.chat.id} from user ${m.from?.id}${m.sender_chat ? ` as ${m.sender_chat.id}` : ""}; set TELEGRAM_CHAT_ID and TELEGRAM_USER_ID to allow it`);
		return new Response("ok");
	},
} satisfies ExportedHandler<Env>;
