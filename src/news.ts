// What shipped lately, for the Lead: each deploy's commit titles, cleaned, kept for a week and shown in the Lead's
// instructions, so it knows a new tool or a changed behaviour before the operator has to explain it. Pure.

export type NewsEntry = { at: number; lines: string[] };

export const NEWS_DAYS = 7;
const MAX_LINES = 15;

/** A commit title as news: no ticket numbers, no board or docs-only housekeeping. Undefined to leave it out. */
export function newsLine(subject: string): string | undefined {
	const s = subject.replace(/^(C-\d+(, | and )?)+(\s*\([^)]*\))?:\s*/, "").trim();
	if (!s || /^(Board|Handbook|Docs?|Merge|Skills from chat)\b/i.test(s)) return undefined;
	return s.length > 220 ? `${s.slice(0, 219)}…` : s;
}

/** The last week's entries plus a new one, newest first, at most MAX_LINES lines in all. */
export function addNews(entries: NewsEntry[], subjects: string[], now: number): NewsEntry[] {
	const lines = subjects.map(newsLine).filter((l): l is string => !!l);
	const kept = entries.filter((e) => e.at > now - NEWS_DAYS * 86_400_000);
	const all = lines.length ? [{ at: now, lines }, ...kept] : kept;
	let left = MAX_LINES;
	return all.map((e) => ({ at: e.at, lines: e.lines.slice(0, Math.max(0, (left -= e.lines.length) + e.lines.length)) })).filter((e) => e.lines.length);
}

/** The Lead's prompt section, or "" when nothing shipped this week. */
export function newsText(entries: NewsEntry[], now: number, day: (ms: number) => string): string {
	const recent = entries.filter((e) => e.at > now - NEWS_DAYS * 86_400_000);
	if (!recent.length) return "";
	return [
		"Shipped to the fleet this week (newest first). Your tools and the crew skill already reflect it; act on it, and mention a change to the operator only when it matters to what they ask:",
		...recent.flatMap((e) => e.lines.map((l) => `- ${day(e.at)}: ${l}`)),
	].join("\n");
}
