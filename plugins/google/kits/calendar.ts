// The Calendar kit: list, create and update events on the operator's primary calendar, in the operator's time zone.
// No delete tool, and nothing that involves guests: the connector refuses guest lists and sends no update emails.
import { CONFIG } from "../../../src/config.ts";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import type { GoogleApi } from "../../../src/google/connector.ts";
import { failure } from "./gmail.ts";

export const TIME_ZONE = CONFIG.timeZone;
const C = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

type When = { date?: string; dateTime?: string; timeZone?: string };
export type CalendarEvent = {
	id: string;
	summary?: string;
	location?: string;
	description?: string;
	start?: When;
	end?: When;
	attendees?: { email: string; self?: boolean; organizer?: boolean }[];
	htmlLink?: string;
	status?: string;
};

const reply = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });

/** The zone's UTC offset at a local wall-clock time, such as +02:00. */
export function offsetAt(local: string, tz = TIME_ZONE): string {
	const guess = new Date(`${local.length === 10 ? `${local}T12:00` : local}:00Z`);
	const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(guess).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
	const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(name);
	return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** A local date or date-time as an RFC 3339 instant (for listing): dates start at local midnight. */
export const instant = (local: string, tz = TIME_ZONE) => (DATE.test(local) ? `${local}T00:00:00${offsetAt(local, tz)}` : LOCAL.test(local) ? `${local}:00${offsetAt(local, tz)}` : local);

/** Start and end as Calendar wants them: all-day dates, or local times in the operator's zone. One hour by default. */
export function eventTimes(start: string, end: string | undefined, tz = TIME_ZONE): { start: When; end: When } | string {
	if (DATE.test(start)) {
		const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
		const last = end && DATE.test(end) ? end : start;
		return { start: { date: start }, end: { date: next(last) } }; // Calendar's all-day end is exclusive
	}
	if (!LOCAL.test(start)) return "Give times as YYYY-MM-DDTHH:MM in the operator's time zone, or YYYY-MM-DD for all day.";
	if (end && !LOCAL.test(end)) return "Give the end like the start: YYYY-MM-DDTHH:MM.";
	const stop = end ?? new Date(Date.parse(`${start}:00Z`) + 3_600_000).toISOString().slice(0, 16);
	return { start: { dateTime: `${start}:00`, timeZone: tz }, end: { dateTime: `${stop}:00`, timeZone: tz } };
}

const FREQ = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" } as const;

/** A repeat as Calendar's RRULE: daily, weekly, monthly or yearly, ending on a date or after a count, or never. */
export function repeatRule(repeat: string, start: string, until?: string, count?: number): string[] | string {
	const freq = FREQ[repeat.trim().toLowerCase() as keyof typeof FREQ];
	if (!freq) return "repeat is one of daily, weekly, monthly, yearly.";
	if (until && !DATE.test(until)) return "repeat_until is a date, YYYY-MM-DD.";
	if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 730)) return "repeat_count is a whole number from 1 to 730.";
	// UNTIL is a date for all-day events and a UTC time otherwise; the end of that day in UTC covers it in the operator's zone too.
	const end = until ? `;UNTIL=${until.replace(/-/g, "")}${DATE.test(start) ? "" : "T235959Z"}` : count ? `;COUNT=${count}` : "";
	return [`RRULE:FREQ=${freq}${end}`];
}

/** Phone reminders, in minutes before the start (at most five, up to four weeks); an empty list means none. */
export function reminderSet(minutes: readonly number[]): { useDefault: false; overrides: { method: "popup"; minutes: number }[] } | string {
	if (minutes.length > 5 || minutes.some((m) => !Number.isInteger(m) || m < 0 || m > 40_320)) return "Give at most five reminders, each in whole minutes up to 40320 (four weeks).";
	return { useDefault: false, overrides: minutes.map((m) => ({ method: "popup", minutes: m })) };
}

const when = (w?: When) => (w?.date ? w.date : (w?.dateTime ?? "").replace(/:00([+-]\d{2}:\d{2}|Z)?$/, "").replace("T", " "));
const guests = (e: CalendarEvent) => (e.attendees ?? []).filter((a) => !a.self);

export const eventLine = (e: CalendarEvent) =>
	`${e.id} · ${when(e.start)}–${when(e.end)} · ${e.summary ?? "(no title)"}${e.location ? ` · ${e.location}` : ""}${guests(e).length ? ` · ${guests(e).length} guest${guests(e).length > 1 ? "s" : ""}` : ""}`;

export function calendarKit(google: () => Promise<GoogleApi>, agent: string): Extension {
	const call = async (method: "GET" | "POST" | "PATCH", url: string, body?: unknown) => (await google()).request(agent, { method, url, body });

	return defineExtension({
		name: "calendar",
		tools: [
			defineTool({
				name: "calendar_list",
				description: `List events on the operator's calendar between two dates or times (${TIME_ZONE}), optionally matching words.`,
				parameters: Type.Object({
					from: Type.String({ description: "YYYY-MM-DD or YYYY-MM-DDTHH:MM" }),
					to: Type.String({ description: "YYYY-MM-DD (exclusive) or YYYY-MM-DDTHH:MM" }),
					query: Type.Optional(Type.String()),
				}),
				replay: "safe",
				execute: async ({ from, to, query }) => {
					const q = new URLSearchParams({ timeMin: instant(from), timeMax: instant(to), singleEvents: "true", orderBy: "startTime", maxResults: "100", timeZone: TIME_ZONE });
					if (query) q.set("q", query);
					const r = await call("GET", `${C}?${q}`);
					if (!r.ok) return failure(r);
					const events = ((r.data as { items?: CalendarEvent[] }).items ?? []).filter((e) => e.status !== "cancelled");
					return reply(events.length ? events.map(eventLine).join("\n") : "No events in that range.");
				},
			}),
			defineTool({
				name: "calendar_create",
				description: `Add an event that only the operator sees (no guests), once or repeating, with phone reminders if wanted. Times are ${TIME_ZONE}.`,
				parameters: Type.Object({
					title: Type.String(),
					start: Type.String({ description: "YYYY-MM-DDTHH:MM, or YYYY-MM-DD for all day" }),
					end: Type.Optional(Type.String({ description: "Default: one hour after a timed start, or the same day" })),
					location: Type.Optional(Type.String()),
					description: Type.Optional(Type.String({ description: "Notes, confirmation numbers, links" })),
					repeat: Type.Optional(Type.String({ description: "daily, weekly, monthly or yearly, counted from the start" })),
					repeat_until: Type.Optional(Type.String({ description: "Last day of the repeat, YYYY-MM-DD; or give repeat_count; neither repeats for ever" })),
					repeat_count: Type.Optional(Type.Integer({ description: "How many times in all" })),
					reminders: Type.Optional(Type.Array(Type.Integer(), { description: "Minutes before the start for a phone reminder, such as [30] or [1440, 60]; leave out for the calendar's default, [] for none" })),
				}),
				replay: "safe",
				execute: async ({ title, start, end, location, description, repeat, repeat_until, repeat_count, reminders }) => {
					const t = eventTimes(start, end);
					if (typeof t === "string") return reply(t, true);
					const recurrence = repeat ? repeatRule(repeat, start, repeat_until, repeat_count) : undefined;
					if (typeof recurrence === "string") return reply(recurrence, true);
					const remind = reminders ? reminderSet(reminders) : undefined;
					if (typeof remind === "string") return reply(remind, true);
					const r = await call("POST", C, { summary: title, location, description, ...t, ...(recurrence ? { recurrence } : {}), ...(remind ? { reminders: remind } : {}) });
					const repeats = repeat ? ` · repeats ${repeat}${repeat_until ? ` until ${repeat_until}` : repeat_count ? `, ${repeat_count} times` : ""}` : "";
					const alerts = reminders?.length ? ` · reminders ${reminders.map((m) => `${m} min`).join(", ")} before` : "";
					return r.ok ? reply(`Added: ${eventLine(r.data as CalendarEvent)}${repeats}${alerts}`) : failure(r);
				},
			}),
			defineTool({
				name: "calendar_update",
				description: "Change an event's title, time, place or notes, by its id. Events with guests are left to the operator: a change would notify them.",
				parameters: Type.Object({
					id: Type.String(),
					title: Type.Optional(Type.String()),
					start: Type.Optional(Type.String({ description: "YYYY-MM-DDTHH:MM or YYYY-MM-DD; give end too when the length changes" })),
					end: Type.Optional(Type.String()),
					location: Type.Optional(Type.String()),
					description: Type.Optional(Type.String()),
					reminders: Type.Optional(Type.Array(Type.Integer(), { description: "Minutes before the start for phone reminders; [] for none" })),
				}),
				replay: "safe",
				execute: async ({ id, title, start, end, location, description, reminders }) => {
					const got = await call("GET", `${C}/${id}`);
					if (!got.ok) return failure(got);
					const event = got.data as CalendarEvent;
					if (guests(event).length) return reply(`"${event.summary}" has guests, who would be notified. Tell the operator to change it in Google Calendar.`, true);
					const patch: Record<string, unknown> = {};
					if (title !== undefined) patch.summary = title;
					if (location !== undefined) patch.location = location;
					if (description !== undefined) patch.description = description;
					if (reminders) {
						const remind = reminderSet(reminders);
						if (typeof remind === "string") return reply(remind, true);
						patch.reminders = remind;
					}
					if (start) {
						const t = eventTimes(start, end);
						if (typeof t === "string") return reply(t, true);
						Object.assign(patch, t);
					}
					const r = await call("PATCH", `${C}/${id}`, patch);
					return r.ok ? reply(`Updated: ${eventLine(r.data as CalendarEvent)}`) : failure(r);
				},
			}),
		],
	});
}
