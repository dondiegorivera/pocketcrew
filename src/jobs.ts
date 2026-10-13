// Job results: the specialist's full answer for its topic, and the few lines that go back to the Lead.
import { FLEET } from "./fleet.ts";
import { passesTo } from "./safety.ts";

const MARK = /^\s*SUMMARY FOR THE LEAD\s*:?\s*$/im;
const TITLE = /^\s*TITLE:\s*(.+?)\s*$/im;
const FALLBACK_CHARS = 600;

/** The answer's TITLE: line (or undefined), the report, and the Lead's summary. */
export function splitSummary(answer: string): { title?: string; report: string; summary: string } {
	const t = TITLE.exec(answer.slice(0, 400));
	const title = t?.[1]?.slice(0, 120);
	const text = t ? answer.slice(0, t.index) + answer.slice(t.index + t[0].length) : answer;
	const m = MARK.exec(text);
	if (!m) return { title, report: text.trim(), summary: text.trim().slice(0, FALLBACK_CHARS) };
	return { title, report: text.slice(0, m.index).trim(), summary: text.slice(m.index + m[0].length).trim().slice(0, FALLBACK_CHARS * 2) };
}

export const STATUSES = ["done", "nothing-found", "needs-operator", "blocked"] as const;
export type JobStatus = { status: (typeof STATUSES)[number]; items?: number; next?: string };

/**
 * The fixed fields a private agent's summary holds (PRIVATE_JOB_INSTRUCTIONS), checked strictly: a status from the list,
 * a number, an agent name. Anything else is dropped, so no free text from a report reaches the Lead.
 */
export function parseStatus(summary: string, agents: readonly string[]): JobStatus | undefined {
	const field = (name: string) => new RegExp(`^\\s*${name}\\s*:\\s*(\\S+)\\s*$`, "im").exec(summary)?.[1]?.toLowerCase();
	const status = STATUSES.find((s) => s === field("STATUS"));
	if (!status) return undefined;
	const items = field("ITEMS");
	const next = field("NEXT");
	return { status, ...(items && /^\d{1,5}$/.test(items) ? { items: Number(items) } : {}), ...(next && agents.includes(next) ? { next } : {}) };
}

/** What the Lead hears of a private job: where the report is, the checked fixed fields, and who may build on it. */
export function privateResultLine(agent: string, st: JobStatus | undefined): string {
	const title = (FLEET as Record<string, { title: string }>)[agent]?.title ?? agent;
	const fields = st ? `Status: ${st.status}${st.items !== undefined ? ` · items: ${st.items}` : ""}${st.next ? ` · suggested next: ${st.next}` : ""}.` : "Status: not given.";
	return `The report went to the operator in the ${title} topic and on the dashboard; it holds private data, so you do not see it. ${fields} To build on it, dispatch with this job in inputs to: ${passesTo(agent).join(", ")}.`;
}

/** A file name for the report: `41-research-agent-escrow-buyers.md`. */
/** Lowercase ASCII words joined by dashes, at most `max` characters: safe in file names and URLs. */
export const slug = (text: string, max = 40) =>
	text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max).replace(/-$/, "");

export function reportName(id: number, agent: string, task: string): string {
	const s = slug(task);
	return `${id}-${agent}${s ? `-${s}` : ""}.md`;
}

/** Reports longer than this go as a file; shorter ones as a message. */
export const FILE_OVER = 800;
