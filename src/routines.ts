// Routines: a brief that runs as a job on a cron in the operator's time (CONFIG.timeZone), such as research every morning.
// The Director stores them and keeps one Agents SDK schedule per routine for its next run, worked out here in local time,
// so runs keep their wall-clock time across daylight saving; each run is an ordinary job (budget, report, library).
import { CONFIG, ZONE_NAME } from "./config.ts";
import { ROUTINE_INSTRUCTIONS } from "./instructions.ts";

export type Routine = { id: number; name: string; agent: string; cron: string; task: string; project: string | null; skills: string | null; model?: string | null; last_run: number | null; last_job: number | null };

const FIELD = /^[\d*,/-]+$/;

/** The operator's time zone (pocketcrew.config.ts): routine crons are read in it. */
export const ZONE = CONFIG.timeZone;

export type LocalTime = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const formatter = new Intl.DateTimeFormat("en-US", {
	timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The wall-clock time in ZONE at `ms`. */
export function localTime(ms: number): LocalTime {
	const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
	return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAYS.indexOf(p.weekday!) };
}

/** `2026-10-11 07:30` in ZONE. */
export const localStamp = (ms: number) => {
	const t = localTime(ms);
	const two = (n: number) => String(n).padStart(2, "0");
	return `${t.year}-${two(t.month)}-${two(t.day)} ${two(t.hour)}:${two(t.minute)}`;
};

/** One cron field (numbers, *, lists, ranges, steps) against a value. Weekday 7 is Sunday, as 0. */
function fieldMatches(field: string, value: number, min: number, max: number): boolean {
	return field.split(",").some((part) => {
		const [range, stepText] = part.split("/");
		const step = stepText ? Number(stepText) : 1;
		const [lo, hi] = range === "*" ? [min, max] : range!.includes("-") ? range!.split("-").map(Number) : [Number(range), stepText ? max : Number(range)];
		return value >= lo! && value <= hi! && (value - lo!) % step === 0;
	});
}

/** Whether a five-field cron names this local time. Day of month and weekday follow cron's rule: either one when both are set. */
export function cronMatches(cron: string, t: LocalTime): boolean {
	const [minute, hour, day, month, weekday] = cron.trim().split(/\s+/) as [string, string, string, string, string];
	const dayOk = fieldMatches(day, t.day, 1, 31);
	const weekdayOk = fieldMatches(weekday, t.weekday, 0, 7) || (t.weekday === 0 && fieldMatches(weekday, 7, 0, 7));
	const days = day !== "*" && weekday !== "*" ? dayOk || weekdayOk : dayOk && weekdayOk;
	return fieldMatches(minute, t.minute, 0, 59) && fieldMatches(hour, t.hour, 0, 23) && fieldMatches(month, t.month, 1, 12) && days;
}

/**
 * The next time after `after` (ms) at which the cron, read in ZONE, is due; undefined if none within a year. The minute is
 * one number (cronProblem), so this looks at that minute of each hour. A local time skipped in spring does not run that day.
 */
export function nextRun(cron: string, after: number): number | undefined {
	const minute = Number(cron.trim().split(/\s+/)[0]);
	const hour = 3_600_000;
	const start = Math.floor(after / hour) * hour + minute * 60_000;
	for (let i = 0; i < 366 * 24 + 2; i++) {
		const t = start + i * hour;
		if (t > after && cronMatches(cron, localTime(t))) return t;
	}
	return undefined;
}

/**
 * A cron saved in UTC moved to the same wall-clock time in ZONE at `now`: the hour shifts by today's offset. Only for a
 * plain hour list whose shift stays within the day (the ones in use); anything else comes back unchanged.
 */
export function utcCronToLocal(cron: string, now: number): string {
	const f = cron.trim().split(/\s+/);
	if (f.length !== 5 || !/^\d+(,\d+)*$/.test(f[1]!)) return cron;
	const offset = localTime(now).hour - new Date(now).getUTCHours();
	const shift = ((offset % 24) + 24 + 12) % 24 - 12;
	const hours = f[1]!.split(",").map((h) => Number(h) + shift);
	if (hours.some((h) => h < 0 || h > 23)) return cron;
	return [f[0], hours.join(","), f[2], f[3], f[4]].join(" ");
}

/** Why the cron is not acceptable, or undefined. A fixed minute keeps a routine to at most one run an hour. */
export function cronProblem(cron: string): string | undefined {
	const fields = cron.trim().split(/\s+/);
	if (fields.length !== 5 || !fields.every((f) => FIELD.test(f))) return `Use a five-field cron: minute hour day month weekday, in ${ZONE_NAME} time.`;
	const minute = Number(fields[0]);
	if (!/^\d{1,2}$/.test(fields[0]!) || minute > 59) return "Give the minute as one number (0 to 59): a routine runs at most once an hour.";
	return undefined;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** ZONE's offset from UTC at that moment, such as +02:00. */
export function utcOffset(ms: number): string {
	const t = localTime(ms);
	const minutes = Math.round((Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute) - Math.floor(ms / 60_000) * 60_000) / 60_000);
	const two = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
	return `${minutes < 0 ? "-" : "+"}${two(minutes / 60)}:${two(minutes % 60)}`;
}

/** The line every message and job starts with, so agents know the day without asking. */
export const nowLine = (ms = Date.now()) => `[Now: ${DAY_NAMES[localTime(ms).weekday]} ${localStamp(ms)}, ${ZONE} (UTC${utcOffset(ms)})]`;

/**
 * The job brief for one run: the routine's own brief behind the instructions that make runs build on each other, with
 * the local day and date, so a routine can rotate by weekday (such as Radar's areas).
 */
export const routineBrief = (r: Pick<Routine, "id" | "name" | "task">, now = Date.now()) =>
	`Routine "${r.name}" (routine #${r.id}), scheduled run on ${DAY_NAMES[localTime(now).weekday]} ${localStamp(now)} ${ZONE_NAME} time.\n${ROUTINE_INSTRUCTIONS}\n\n${r.task}`;
