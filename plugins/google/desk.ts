// The google plugin's Director part: the 15-minute new-mail watch, "📬 Needs you" with its buttons when triage flags a
// mail, the /google and /docs commands, and a small Gmail helper for features that act without a model (/inbox).
// Every request still passes the connector's allow-list (google/allow.ts).
import type { Step } from "../../src/director/onboarding.ts";
import { isAgentName, LEAD } from "../../src/fleet.ts";
import { LABEL_PREFIX } from "../../src/google/allow.ts";
import { fileId, fileLink, type GrantedFile } from "../../src/google/files.ts";
import { CALLBACK_PATH, SCOPE_NAMES } from "../../src/google/oauth.ts";
import type { SentStore } from "../../src/reactions.ts";
import type { Button } from "../../src/telegram.ts";
import { type Ctx, general, Kv } from "../../src/director/context.ts";
import type { Finished, Jobs } from "../../src/director/jobs.ts";
import type { PluginHost } from "../../src/plugin.ts";
import { localStamp, localTime } from "../../src/routines.ts";
import type { Reminders } from "../../src/director/reminders.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export const mailButtons = (job: number): Button[][] => [[{ text: "✍️ Draft reply", data: `m:d:${job}` }, { text: "🗄 Archive", data: `m:a:${job}` }, { text: "⏰ Tomorrow", data: `m:t:${job}` }]];

export class GoogleDesk {
	private readonly kv: Kv;
	private readonly ctx: Ctx;
	private readonly jobs: Jobs;
	private readonly sent: SentStore;
	private readonly reminders: Reminders;
	constructor(host: PluginHost) {
		this.ctx = host.ctx;
		this.jobs = host.jobs;
		this.sent = host.sent;
		this.reminders = host.reminders;
		this.kv = host.kv;
		host.jobs.onDone("mailwatch:", (f) => this.triaged(f));
		host.buttons.register("m", (t) => this.mailTap(t.action, Number(t.arg), t.id, t.done));
		host.reminders.shows("needsyou", (ref, text) => general(this.ctx, text, { buttons: mailButtons(Number(ref)) }));
		host.commands.register("google", async (arg) => general(this.ctx, await this.command(arg)));
		host.commands.register("docs", async (arg) => general(this.ctx, await this.docs(arg)));
		host.digests.top.push(() => this.calendarLine());
		host.digests.waiting.push(() => this.waitingLines());
		host.digests.health.push(() => this.healthLines());
		host.onboarding.action("google", async (tap) => {
			await tap.done("Here is the sign-in link.");
			await general(this.ctx, await this.command("connect"));
		});
		host.onboarding.steps.push(() => this.onboardingSteps());
	}

	/** /start's Google line: the client set up, signed in, every permission granted. */
	async onboardingSteps(): Promise<Step[]> {
		const st = await this.ctx.google().status().catch(() => undefined);
		if (!st?.configured) return [{ state: "todo", text: "Google: create an OAuth client (docs/setup.md, Google), then npm run google on your computer." }];
		if (!st.connected) return [{ state: "todo", text: "Google: sign in, so Mail, Calendar and Clerk can work.", button: { text: "Sign in with Google", data: "o:google" } }];
		if (st.missing?.length) return [{ state: "todo", text: `Google: missing ${st.missing.map((s) => SCOPE_NAMES[s] ?? s).join(", ")}; sign in again and tick every box.`, button: { text: "Sign in again", data: "o:google" } }];
		return [{ state: "done", text: "Google: signed in, every permission granted." }];
	}

	/** A Gmail API call as the Director; throws with Gmail's answer when refused. */
	async gmail(method: "GET" | "POST", path: string, body?: unknown) {
		const r = await this.ctx.google().request("director", { method, url: `${GMAIL}${path}`, body });
		if (!r.ok) throw new Error(`Gmail answered ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
		return r.data as Record<string, unknown>;
	}

	/** <name>/archived: the trail every archive leaves, so it can be undone. */
	async archivedLabel(): Promise<string> {
		const labels = ((await this.gmail("GET", "/labels")).labels ?? []) as { id: string; name: string }[];
		const found = labels.find((l) => l.name === `${LABEL_PREFIX}archived`);
		return found ? found.id : String((await this.gmail("POST", "/labels", { name: `${LABEL_PREFIX}archived`, labelListVisibility: "labelShow", messageListVisibility: "show" })).id);
	}

	/**
	 * New inbox mail not yet triaged becomes one Mail job, at most 25 messages at a time. Finding it costs no model
	 * call; the job runs only when there is something new and no triage job is already open.
	 */
	async watch() {
		if (!isAgentName("mail") || this.kv.get("mailwatch") === "off") return;
		const g = this.ctx.google();
		if (!(await g.status()).connected) return;
		if (this.jobs.withKey("mailwatch:", ["queued", "running"]).some((j) => j.agent === "mail")) return;
		const q = new URLSearchParams({ q: `in:inbox -label:${LABEL_PREFIX}triaged newer_than:3d`, maxResults: "25" });
		const r = await g.request("director", { method: "GET", url: `${GMAIL}/messages?${q}` });
		if (!r.ok) return void console.error(`mail watch: Gmail answered ${r.status}`);
		const found = (r.data as { messages?: { id: string; threadId: string }[] }).messages ?? [];
		if (!found.length) return;
		const threads = [...new Set(found.map((m) => m.threadId))];
		const brief =
			`Triage new inbox mail: ${found.length} message${found.length > 1 ? "s" : ""} in ${threads.length} thread${threads.length > 1 ? "s" : ""}.\n` +
			`Threads: ${threads.join(", ")}\nMessages: ${found.map((m) => m.id).join(", ")}\n\n` +
			"Read each thread with gmail_read, label every listed message with its category and triaged, archive what inbox-rules lets go, draft replies where the answer is clear, then report.";
		await this.jobs.create(`mailwatch:${found[0]!.id}:${found.length}`, "mail", brief);
	}

	/**
	 * Triage finished: quiet, unless a mail needs the operator. Then "📬 Needs you" in General with the report's title
	 * (it goes to the operator only), and the fixed fields to the Lead, quietly, so "draft a reply to that" works.
	 */
	private async triaged(f: Finished) {
		if (!f.needsOperator) return;
		const id = f.job.id;
		const text = `📬 Needs you: ${f.title ?? "new mail"}\nIn the Mail topic (job #${id}). Tap below, or say here what to do.`;
		const sentId = await general(this.ctx, text, { buttons: mailButtons(id) });
		if (sentId !== undefined) this.sent.note(sentId, { agent: "mail", kind: "needsyou", job: id, text });
		await (await this.ctx.agent(LEAD)).jobResult(id, f.job.agent, f.status, f.forLead, true);
	}

	private async mailTap(action: string, job: number, tap: string, done: (note: string) => Promise<void>) {
		if (action === "t") {
			this.reminders.tomorrow({ text: `⏰ From yesterday: ${this.jobs.get(job)?.title ?? `mail in job #${job}`}`, kind: "needsyou", ref: String(job) });
			return done("I'll bring it back tomorrow at 09:00.");
		}
		const brief =
			action === "d"
				? `The operator tapped "Draft reply" on the mail that job #${job} said needs them (its report is your input). Draft a reply in that thread with gmail_draft, in the mail's language, from the right send-as address. Never send. Say in two lines what the draft says.`
				: `The operator tapped "Archive" on the mail that job #${job} said needs them (its report is your input): they have seen it. Archive just that mail with gmail_archive and say so in one line.`;
		const answer = await this.jobs.create(`button:${tap}`, "mail", brief, undefined, [], undefined, [job]);
		const started = /Job #(\d+)/.exec(answer)?.[1];
		return done(started ? `${action === "d" ? "Mail is drafting a reply" : "Mail is archiving it"} (job #${started}).` : answer);
	}

	/** `/google`, `/google connect|disconnect`, `/google watch on|off`. */
	async command(arg: string): Promise<string> {
		const g = this.ctx.google();
		const [verb, value] = arg.split(/\s+/);
		if (verb === "connect") {
			const url = await g.connectUrl(`${this.ctx.publicUrl}${CALLBACK_PATH}`).catch((err: Error) => err);
			if (url instanceof Error) return url.message;
			return `Sign in with Google (link works once, for 15 minutes):\n${url}\n\nGoogle will say it hasn't verified this app: it is your own. Choose Advanced, then continue.`;
		}
		if (verb === "disconnect") return (await g.disconnect()) ? "Google disconnected; the sign-in is revoked at Google too." : "Google was not connected.";
		if (verb === "watch" && (value === "on" || value === "off")) {
			this.kv.set("mailwatch", value);
			return value === "on" ? "New-mail triage is on: every 15 minutes." : "New-mail triage is off. Mail still answers when asked.";
		}
		const st = await g.status();
		if (!st.configured) return "Google is not set up yet. The OAuth client id and secret go in with scripts/google-secrets.sh on the server.";
		if (!st.connected) return "Google is set up but not connected. Send /google connect.";
		const perms = st.missing === undefined ? "Permissions: not known yet." : st.missing.length ? `⚠️ Missing permissions: ${st.missing.map((s) => SCOPE_NAMES[s] ?? s).join(", ")}. Send /google connect and tick every box on Google's page.` : "Permissions: all granted.";
		return `Google: connected as ${st.email} since ${new Date(st.since ?? 0).toISOString().slice(0, 10)}. New-mail triage: ${this.kv.get("mailwatch") === "off" ? "off" : "on, every 15 minutes"}.\n${perms}`;
	}

	/** `/docs`: the operator's own Docs and Sheets the fleet may edit, one by one. */
	async docs(arg: string): Promise<string> {
		const g = this.ctx.google();
		const [verb, link] = arg.split(/\s+/);
		if ((verb === "allow" || verb === "revoke") && link) {
			const id = fileId(link);
			if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) return "Give the file's link, as the address bar shows it.";
			if (verb === "revoke") return (await g.ungrant(id)) ? "Done: the fleet can only read that file again." : "That file was not on the list.";
			const kind = /\/spreadsheets\//.test(link) ? "sheet" : /\/document\//.test(link) ? "doc" : undefined;
			const f = await g.grant(id, kind).catch((err: Error) => err);
			if (f instanceof Error) return f.message;
			return `Clerk may now edit the ${f.kind === "doc" ? "document" : "sheet"} "${f.title}": add and replace text${f.kind === "sheet" ? ", write cells, add tabs" : ""}. It cannot delete, clear or share it, and Google's version history (File → Version history) undoes any edit. /docs revoke <link> takes it back.`;
		}
		const { granted, created } = await g.files();
		const list = granted.map((f: GrantedFile) => `- ${f.kind === "doc" ? "📄" : "📊"} ${f.title} (since ${new Date(f.at).toISOString().slice(0, 10)})\n  ${fileLink(f)}`).join("\n");
		return [
			granted.length ? `Your files the fleet may edit:\n${list}` : "None of your own files is open for editing.",
			`It also edits the ${created} file${created === 1 ? "" : "s"} it created itself. It reads any Doc or Sheet you give it a link to.`,
			"/docs allow <link>: let it edit one of yours · /docs revoke <link>: back to read-only",
		].join("\n\n");
	}

	/** Today's events on the main calendar, read without a model. */
	async calendarLine(): Promise<string[]> {
		const now = this.ctx.now();
		const g = this.ctx.google();
		if (!(await g.status()).connected) return [];
		const t = localTime(now);
		const start = now - ((t.hour * 60 + t.minute) * 60_000 + (now % 60_000));
		const q = new URLSearchParams({ timeMin: new Date(start).toISOString(), timeMax: new Date(start + 86_400_000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "12" });
		const r = await g.request("director", { method: "GET", url: `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}` });
		if (!r.ok) return [];
		const items = (r.data as { items?: { summary?: string; start?: { dateTime?: string; date?: string } }[] }).items ?? [];
		if (!items.length) return ["📅 Nothing on your calendar today."];
		const when = (e: (typeof items)[number]) => (e.start?.dateTime ? localStamp(Date.parse(e.start.dateTime)).slice(11) : "all day");
		return [`📅 Today: ${items.map((e) => `${when(e)} ${e.summary ?? "(no title)"}`).join(" · ")}`];
	}

	/** Briefing lines: permissions the sign-in lacks, and drafts the fleet wrote that wait unsent. */
	async waitingLines(): Promise<string[]> {
		const g = this.ctx.google();
		const st = await g.status().catch(() => undefined);
		if (!st?.connected) return [];
		const out: string[] = [];
		if (st.missing?.length) out.push(`🔑 Google lacks: ${st.missing.map((s) => SCOPE_NAMES[s] ?? s).join(", ")} · /google connect`);
		const drafts = await g.fleetDrafts().catch(() => 0);
		if (drafts) out.push(`✉️ ${drafts} draft${drafts === 1 ? "" : "s"} the fleet wrote ${drafts === 1 ? "is" : "are"} waiting in your Gmail Drafts`);
		return out;
	}

	async healthLines(): Promise<string[]> {
		const st = await this.ctx.google().status().catch(() => undefined);
		return st?.configured && !st.connected ? ["⚠️ Google is not connected: mail, calendar and docs work stops · /google connect"] : [];
	}

	mailWatchOn(): boolean {
		return this.kv.get("mailwatch") !== "off";
	}
}
