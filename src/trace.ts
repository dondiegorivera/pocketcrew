// `/trace <agent>`: the last steps of an agent's transcript in a few lines, to see from the phone why a run stalled.
import type { EntryRecord } from "@earendil-works/pi-durable";

type Part = { type: string; text?: string; name?: string };
type Msg = { role: string; content: string | Part[]; stopReason?: string; errorMessage?: string; toolName?: string; isError?: boolean; durationMs?: number; timestamp?: number };

const clip = (s: string, n = 100) => {
	const flat = s.replace(/\s+/g, " ").trim();
	return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};
const textOf = (c: Msg["content"]) => (typeof c === "string" ? c : c.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join(" "));
const time = (ms?: number) => (ms ? new Date(ms).toISOString().slice(11, 19) : "--:--:--");

/** `wide` keeps more of each line, for the server-side diagnostic rather than a phone. */
export function traceLines(entries: readonly EntryRecord[], last = 10, wide = false): string {
	const w = wide ? 6 : 1;
	const lines: string[] = [];
	for (const e of entries) {
		for (const m of (e.model ?? []) as unknown as Msg[]) {
			if (m.role === "user") lines.push(`${time(m.timestamp)} you/job: ${clip(textOf(m.content), 100 * w)}`);
			else if (m.role === "assistant") {
				const parts = typeof m.content === "string" ? [] : m.content;
				const calls = parts.filter((p) => p.type === "toolCall").map((p) => p.name);
				const took = m.durationMs ? ` ${(m.durationMs / 1000).toFixed(1)}s` : "";
				const what = m.errorMessage ? `error: ${clip(m.errorMessage, 300 * w)}` : calls.length ? `calls ${calls.join(", ")}` : clip(textOf(m.content), 100 * w);
				lines.push(`${time(m.timestamp)} model [${m.stopReason ?? "?"}${took}]: ${what}`);
			} else if (m.role === "toolResult") lines.push(`${time(m.timestamp)} ${m.toolName}${m.isError ? " ✗" : " ✓"}: ${clip(textOf(m.content), 80 * w)}`);
		}
	}
	return lines.length ? lines.slice(-last).join("\n") : "The transcript is empty.";
}
