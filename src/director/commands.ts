// Every Telegram message: voice notes heard and files read first; in a specialist's topic, its own commands or a chat
// with it; in General, a registered slash command, a typed answer a feature is waiting for, or the Lead.
import { withFile } from "../attachments.ts";
import { help } from "../help.ts";
import { LEAD } from "../fleet.ts";
import { command, type Update } from "../telegram.ts";
import { type Ctx, general } from "./context.ts";
import type { Fleet } from "./fleet.ts";

export type CommandHandler = (arg: string, update: Update) => Promise<unknown>;

export class Commands {
	private readonly handlers = new Map<string, CommandHandler>();
	/** Typed text a feature may take instead of the Lead (a price /sales asked for); first to say true wins. */
	readonly interceptors: ((text: string) => Promise<boolean>)[] = [];

	private readonly ctx: Ctx;
	private readonly fleet: Fleet;
	constructor(ctx: Ctx, fleet: Fleet) {
		this.ctx = ctx;
		this.fleet = fleet;
	}

	register(name: string, handler: CommandHandler) {
		if (this.handlers.has(name)) throw new Error(`command /${name} is taken`);
		this.handlers.set(name, handler);
	}
	names(): string[] {
		return [...this.handlers.keys()];
	}

	async dispatch(update: Update) {
		const m = update.message!;
		try {
			await this.route(update);
		} catch (err) {
			// Say it where it happened: a silent failure looks like a dead bot.
			console.error(`dispatch ${update.update_id} failed:`, err);
			await (await this.ctx.tg()).say(m.is_topic_message ? m.message_thread_id : undefined, `⚠️ ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
		}
	}

	private async route(update: Update) {
		const m = update.message!;
		const thread = m.is_topic_message ? m.message_thread_id : undefined;
		const reply = async (t: string) => (await this.ctx.tg()).say(thread, t);
		let text = m.text ?? "";
		const voice = m.voice ?? m.audio;
		if (!text && voice) {
			// Voice works everywhere: transcribe, show what was heard so a mishearing is caught, then route as text.
			const heard = await this.ctx.media.transcribe(voice).catch((err: Error) => err);
			if (heard instanceof Error) return reply(`🎙 ${heard.message}`);
			await reply(`🎙 “${heard}”`);
			text = `(voice note, transcribed; names and numbers may be misheard) ${heard}`;
		}
		if (!text && m.document) {
			const file = await this.ctx.media.readDocument(m.document).catch((err: Error) => err);
			if (file instanceof Error) return reply(`📎 ${file.message}`);
			await reply(`📎 Read ${m.document.file_name ?? "the file"} (${file.length} characters).`);
			text = withFile(m.caption, m.document.file_name, file);
		}
		const name = this.fleet.agentOfThread(thread);
		const cmd = command(text);
		console.log(`update ${update.update_id}: thread ${thread ?? "general"} → ${name ?? "general"}, ${cmd ? `/${cmd[0]}` : "text"}`);

		if (name) {
			const agent = await this.ctx.agent(name);
			switch (cmd?.[0]) {
				case "stop":
					return void (await agent.stop(), await reply("⏹ Stopped."));
				case "pause":
					return void (await agent.pause(true), await reply("⏸ Paused."));
				case "resume":
					return void (await agent.pause(false), await reply("▶️ Resumed."));
				case "reset":
					return void (await agent.reset(), await reply("🧹 Fresh context."));
				case "status":
					return reply(await this.fleet.statusText([name]));
				case "trace":
					return reply(await agent.trace());
				case "notes":
					return reply(await agent.notesText());
				default:
					return agent.receive(update.update_id, text);
			}
		}

		// General, or a topic whose agent is no longer in the fleet.
		if (!cmd) {
			for (const take of this.interceptors) if (await take(text)) return;
			return (await this.ctx.agent(LEAD)).receive(update.update_id, text);
		}
		const [verb, arg] = cmd;
		const handler = this.handlers.get(verb);
		return handler ? handler(arg, update) : general(this.ctx, help());
	}
}
