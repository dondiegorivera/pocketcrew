// What reaches the operator's phone, and how loudly. Pure formatting for the Director: which finished jobs the Lead
// hears about, the one morning briefing of the routines, the evening inbox line, /today, and the weekly list of
// routines whose pages nobody opened. Only these and the Lead's own answers notify; everything else arrives silently.
import { CONFIG } from "./config.ts";
import { localTime } from "./routines.ts";
import { parseStatus } from "./jobs.ts";

export type DoneJob = { id: number; key: string; agent: string; status: string; title: string | null; summary: string | null; cost: number | null; created: number; finished: number | null };

/** Where a job came from: the new-mail watch, a routine, a wish, or a request (the operator's, through the Lead). */
/** "tap": a job a button or a reaction started (draft a reply, archive, file into the notes): it reports back itself. */
export type JobKind = "mail" | "routine" | "wish" | "prices" | "tap" | "asked";
export const jobKind = (key: string): JobKind =>
	key.startsWith("mailwatch:")
		? "mail"
		: key.startsWith("routine:")
			? "routine"
			: key.startsWith("wish:")
				? "wish"
				: key.startsWith("prices:")
					? "prices"
					: /^(button|inbox|react):/.test(key)
						? "tap"
						: "asked";
export const routineIdOf = (key: string): number | undefined => (key.startsWith("routine:") ? Number(key.split(":")[1]) : undefined);

/** The first page a job published (its summary carries `Page: <url>` lines). */
export const firstPage = (summary: string | null) => /^Page: (\S+)/m.exec(summary ?? "")?.[1];

/** A private job's report said it needs the operator (its fixed STATUS field). */
export const needsOperator = (summary: string | null, agents: readonly string[]) => parseStatus(summary ?? "", agents)?.status === "needs-operator";

/** The local day as `2026-10-12`, the key for once-a-day messages. */
export const localDay = (ms: number) => {
	const t = localTime(ms);
	return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (ms: number) => {
	const t = localTime(ms);
	return `${DAYS[t.weekday]} ${t.day} ${MONTHS[t.month - 1]}`;
};

/** The owner's hours (pocketcrew.config.ts): the briefing, when it stops waiting for running routines, the inbox line. */
export const BRIEFING_HOUR = CONFIG.briefingHour;
export const BRIEFING_LATEST_HOUR = CONFIG.briefingLatestHour;
export const INBOX_HOUR = CONFIG.inboxHour;
export const NIGHTLY_HOUR = CONFIG.nightlyHour;

/** One line for a finished routine job: its name, the report's title, a needs-you mark and the page. */
export function routineLine(name: string, j: DoneJob, agents: readonly string[]): string {
	if (j.status !== "done") return `• ${name}: ⚠️ ${j.status}`;
	const page = firstPage(j.summary);
	return `• ${name}: ${j.title ?? "done"}${needsOperator(j.summary, agents) ? " · 👉 needs you" : ""}${page ? `\n  🔗 ${page}` : ""}`;
}

/** The morning briefing: every routine since the last one, one line each; undefined when there is nothing to say. */
export function briefingText(now: number, done: { name: string; job: DoneJob }[], running: string[], agents: readonly string[], extra: string[] = [], top: string[] = []): string | undefined {
	if (!done.length && !running.length && !extra.length && !top.length) return undefined;
	return [
		`☀️ ${dayLabel(now)}`,
		...top,
		...done.map((d) => routineLine(d.name, d.job, agents)),
		...(running.length ? [`Still running: ${running.join(", ")}`] : []),
		...(extra.length ? ["", ...extra] : []),
	].join("\n");
}

const INBOX_TITLES = 8;

/** The evening inbox line: what the mail watch handled since the last one. */
export function inboxText(jobs: DoneJob[], agents: readonly string[]): string | undefined {
	if (!jobs.length) return undefined;
	const items = jobs.reduce((n, j) => n + (parseStatus(j.summary ?? "", agents)?.items ?? 0), 0);
	const needs = jobs.filter((j) => needsOperator(j.summary, agents)).length;
	const failed = jobs.filter((j) => j.status !== "done").length;
	const titles = jobs.filter((j) => j.title).map((j) => `• ${j.title}`);
	return [
		`📬 Inbox: ${items || jobs.length} mail${(items || jobs.length) === 1 ? "" : "s"} sorted · ${needs ? `${needs} needed you (sent at the time)` : "none needed you"}${failed ? ` · ${failed} check${failed === 1 ? "" : "s"} failed` : ""}`,
		...titles.slice(0, INBOX_TITLES),
		...(titles.length > INBOX_TITLES ? [`+${titles.length - INBOX_TITLES} more in the Mail topic`] : []),
	].join("\n");
}

/** /today: what ran, what needs the operator, what it cost. */
export function todayText(now: number, jobs: DoneJob[], routineName: (key: string) => string, agents: readonly string[], spend: string): string {
	const routines = jobs.filter((j) => jobKind(j.key) === "routine");
	const mail = jobs.filter((j) => jobKind(j.key) === "mail");
	const asked = jobs.filter((j) => ["asked", "wish", "prices", "tap"].includes(jobKind(j.key)));
	const open = (j: DoneJob) => j.status === "queued" || j.status === "running";
	const line = (j: DoneJob) => (open(j) ? `• ${routineName(j.key)}: ${j.status}` : routineLine(routineName(j.key), j, agents));
	const mailItems = mail.reduce((n, j) => n + (parseStatus(j.summary ?? "", agents)?.items ?? 0), 0);
	const mailNeeds = mail.filter((j) => needsOperator(j.summary, agents)).length;
	return [
		`📅 ${dayLabel(now)}`,
		routines.length ? `Routines (${routines.length}):` : "No routines ran today.",
		...routines.map(line),
		mail.length ? `Mail: ${mail.length} check${mail.length === 1 ? "" : "s"}, ${mailItems} mail${mailItems === 1 ? "" : "s"} sorted, ${mailNeeds ? `${mailNeeds} needed you` : "none needed you"}` : "Mail: no new mail sorted.",
		...(asked.length ? [`Your jobs (${asked.length}):`, ...asked.map((j) => `• #${j.id} ${j.agent}: ${open(j) ? j.status : (j.title ?? j.status)}`)] : []),
		spend,
	].join("\n");
}

export const UNREAD_DAYS = 14;
const UNREAD_MIN_RUNS = 3;

/**
 * Routines worth a question: in the last two weeks they published pages at least three times and the operator opened
 * none of them. `opened` holds the page URLs that were viewed.
 */
export function unreadRoutines(runs: { routine: string; page: string }[], opened: Set<string>): string[] {
	const by = new Map<string, string[]>();
	for (const r of runs) by.set(r.routine, [...(by.get(r.routine) ?? []), r.page]);
	return [...by].filter(([, pages]) => pages.length >= UNREAD_MIN_RUNS && !pages.some((p) => opened.has(p))).map(([name]) => name);
}
