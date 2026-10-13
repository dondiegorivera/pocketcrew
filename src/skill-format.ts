// The skill format, with no dependencies, so scripts/bundle-skills.mjs can run with plain node: a SKILL.md in the
// Agent Skills shape (front matter, then instructions), the limits, and how a repo copy and a chat copy compare.

export type Skill = {
	name: string;
	description: string;
	/** Agents that see it; empty means every agent. */
	agents: string[];
	body: string;
	/** Reference files by name, read on demand. */
	files: Record<string, string>;
	/** repo: skills/ in git. chat: saved by the Lead. proposed: saved by another agent, or installed from a URL. */
	source: "repo" | "chat" | "proposed";
	/** Where a proposed skill came from: its URL, or the agent that proposed it. */
	origin?: string;
	/** When it was last saved (ms). The sync writes it into SKILL.md, so a bundled copy and a chat copy can be compared. */
	updated?: number;
	/** `editable: dev` in a repo skill's front matter: only the developer changes it, in the repo; chat cannot. */
	devOnly?: boolean;
};

export const MAX_SKILL_CHARS = 20_000;
export const MAX_FILE_CHARS = 60_000;
const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * A SKILL.md parsed: front matter `name`, `description`, optional `agents` (comma-separated) and `editable: dev`, and
 * the `updated` and `origin` the sync writes for skills that came from chat; then the body.
 */
export function parseSkill(markdown: string): Omit<Skill, "files" | "source"> | string {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown.trimStart());
	if (!m) return "A skill starts with front matter between --- lines: name and description.";
	const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(m[1]!)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
	const updated = Number(field("updated"));
	return skillProblem({
		name: field("name"),
		description: field("description"),
		agents: field("agents").split(/[,\s]+/).filter(Boolean),
		body: m[2]!.trim(),
		...(updated > 0 ? { updated } : {}),
		...(field("origin") ? { origin: field("origin") } : {}),
		...(field("editable") === "dev" ? { devOnly: true } : {}),
	});
}

/** The skill as given, or why it is not acceptable. */
export function skillProblem(s: Omit<Skill, "files" | "source">): Omit<Skill, "files" | "source"> | string {
	if (!NAME.test(s.name)) return `Skill name "${s.name}": use lowercase letters, digits and dashes, at most 48 characters.`;
	if (!s.description) return `Skill ${s.name}: a one-line description is needed; agents choose skills by it.`;
	if (s.description.length > 300) return `Skill ${s.name}: keep the description under 300 characters.`;
	if (!s.body) return `Skill ${s.name}: the instructions are empty.`;
	if (s.body.length > MAX_SKILL_CHARS) return `Skill ${s.name}: over ${MAX_SKILL_CHARS} characters; move detail into reference files.`;
	return s;
}

/**
 * One catalog from the repo's skills and the Director's: by name, the newer copy wins. A chat copy without a newer
 * bundled one is an edit git has not caught up with yet; a bundled copy at least as new means the sync committed it.
 */
export function mergeSkills(bundled: readonly Skill[], chat: readonly Skill[]): Skill[] {
	const byName = new Map(bundled.map((s) => [s.name, s]));
	for (const c of chat) if (!byName.get(c.name)?.devOnly && (c.updated ?? 0) > (byName.get(c.name)?.updated ?? -1)) byName.set(c.name, c);
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Chat copies the deployed bundle has caught up with: safe to drop from the Director. */
export const superseded = (bundled: readonly Skill[], chat: readonly Skill[]) =>
	chat.filter((c) => bundled.some((b) => b.name === c.name && (b.updated ?? 0) >= (c.updated ?? 0))).map((c) => c.name);

export const visibleTo = (s: Pick<Skill, "agents">, agent: string) => s.agents.length === 0 || s.agents.includes(agent);

/** A skill as the SKILL.md the sync commits: what parseSkill reads back, `updated` included. */
export function skillMarkdown(s: Omit<Skill, "files" | "source">): string {
	const line = (v: string) => v.replace(/\s+/g, " ").trim();
	return [
		"---",
		`name: ${s.name}`,
		`description: ${line(s.description)}`,
		...(s.agents.length ? [`agents: ${s.agents.join(", ")}`] : []),
		...(s.devOnly ? ["editable: dev"] : []),
		...(s.updated ? [`updated: ${s.updated}`] : []),
		...(s.origin ? [`origin: ${line(s.origin)}`] : []),
		"---",
		"",
		s.body.trim(),
		"",
	].join("\n");
}

/** File names a skill folder may hold besides SKILL.md. */
export const isReferenceFileName = (name: string) => /^[\w.-]+\.(md|txt)$/.test(name) && name !== "SKILL.md" && !name.startsWith(".");

export const isSkillName = (name: string) => NAME.test(name);

/**
 * Who may see a skill. Text from outside (a URL, or an agent that reads the web) never reaches the Lead, which holds the
 * operator's notes and dispatches work: such a skill goes to the named agents minus the Lead, or to every specialist.
 * Returns the agents (empty: every agent), or why the skill cannot be saved.
 */
export function skillScope(agents: readonly string[], outside: boolean, fleet: { all: readonly string[]; lead: string }): string[] | string {
	const unknown = agents.filter((a) => !fleet.all.includes(a));
	if (unknown.length) return `No agent ${unknown.join(", ")}. Agents: ${fleet.all.join(", ")}.`;
	if (!outside) return [...agents];
	const kept = (agents.length ? agents : fleet.all).filter((a) => a !== fleet.lead);
	return kept.length ? kept : "That skill would reach only the Lead, which takes no skills from outside text.";
}
