// Skills: named instruction packs in the Agent Skills shape, a SKILL.md with `name` and `description` up front and the
// instructions below, plus optional reference files. Agents see only the catalog (name and description) in their prompt
// and read a skill when the task calls for it; a job or routine can also carry skills in full.
//
// Two sources, one catalog: skills/<name>/ in the repo (bundled at deploy by scripts/bundle-skills.mjs) and skills the
// operator gives the Lead in chat (kept in the Director's SQLite). Only the Lead saves skills; every save is announced.
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable";
import type { Skill } from "./skill-format.ts";
import type { Sql } from "./sql.ts";

export * from "./skill-format.ts";

type SkillRow = { name: string; description: string; agents: string; body: string; files: string | null; origin: string | null; updated: number };

const toSkill = (r: SkillRow): Skill => ({
	name: r.name,
	description: r.description,
	body: r.body,
	agents: JSON.parse(r.agents) as string[],
	files: JSON.parse(r.files ?? "{}") as Record<string, string>,
	source: r.origin ? "proposed" : "chat",
	origin: r.origin ?? undefined,
	updated: r.updated,
});

const KEEP_VERSIONS = 10;

/**
 * Skills saved in chat, in the Director's SQLite. A save is live at once; every version it replaces (or a delete
 * removes) goes to `skill_history`, so `/skills undo` is always one step back.
 */
export class SkillsStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
		sql("CREATE TABLE IF NOT EXISTS skills (name TEXT PRIMARY KEY, description TEXT, agents TEXT, body TEXT, updated INTEGER)");
		const have = new Set(sql<{ name: string }>("SELECT name FROM pragma_table_info('skills')").map((c) => c.name));
		for (const [col, type] of [["files", "TEXT"], ["origin", "TEXT"]] as const) if (!have.has(col)) sql(`ALTER TABLE skills ADD COLUMN ${col} ${type}`);
		sql("CREATE TABLE IF NOT EXISTS skill_history (name TEXT, description TEXT, agents TEXT, body TEXT, files TEXT, origin TEXT, updated INTEGER, replaced INTEGER)");
		// Earlier versions held proposals for approval (a status column, then a table); there is no approval step any more.
		if (sql<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'skill_proposals'").length) {
			for (const r of sql<SkillRow>("SELECT * FROM skill_proposals")) this.save({ ...toSkill(r), origin: r.origin ?? undefined });
			sql("DROP TABLE skill_proposals");
		}
	}

	list(): Skill[] {
		return this.sql<SkillRow>("SELECT name, description, agents, body, files, origin, updated FROM skills ORDER BY name").map(toSkill);
	}

	get(name: string): Skill | undefined {
		return this.list().find((s) => s.name === name);
	}

	private keep(name: string, now: number) {
		this.sql("INSERT INTO skill_history SELECT name, description, agents, body, files, origin, updated, ? FROM skills WHERE name = ?", now, name);
		this.sql(
			"DELETE FROM skill_history WHERE name = ? AND rowid NOT IN (SELECT rowid FROM skill_history WHERE name = ? ORDER BY replaced DESC, rowid DESC LIMIT ?)",
			name, name, KEEP_VERSIONS,
		);
	}

	/** Live at once; the version it replaces is kept for undo. `origin`: a URL, or the agent that saved it if not the Lead. */
	save(s: Omit<Skill, "files" | "source"> & { files?: Record<string, string> }, now = Date.now()) {
		this.keep(s.name, now);
		this.sql(
			"INSERT OR REPLACE INTO skills (name, description, agents, body, files, origin, updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
			s.name, s.description, JSON.stringify(s.agents), s.body, JSON.stringify(s.files ?? {}), s.origin ?? null, now,
		);
	}

	remove(name: string, now = Date.now()): boolean {
		if (!this.get(name)) return false;
		this.keep(name, now);
		this.sql("DELETE FROM skills WHERE name = ?", name);
		return true;
	}

	/**
	 * One step back: the version before the last save or delete comes back. Without one, the saved copy goes and the
	 * repo's version (if any) applies again. Returns what happened, or undefined when there is nothing to undo.
	 */
	undo(name: string, now = Date.now()): "restored" | "removed" | undefined {
		const prev = this.sql<SkillRow & { rowid: number }>("SELECT rowid, * FROM skill_history WHERE name = ? ORDER BY replaced DESC, rowid DESC LIMIT 1", name)[0];
		if (prev) {
			this.sql("DELETE FROM skill_history WHERE rowid = ?", prev.rowid);
			this.sql("INSERT OR REPLACE INTO skills (name, description, agents, body, files, origin, updated) VALUES (?, ?, ?, ?, ?, ?, ?)", prev.name, prev.description, prev.agents, prev.body, prev.files, prev.origin, now);
			return "restored";
		}
		if (!this.get(name)) return undefined;
		this.sql("DELETE FROM skills WHERE name = ?", name);
		return "removed";
	}
}

/** The prompt section: what an agent may use, one line each. */
export const catalogText = (skills: readonly Skill[]) =>
	skills.length ? ["Skills you can use. When a task matches one, read it with read_skill first and follow it.", ...skills.map((s) => `- ${s.name}: ${s.description}`)].join("\n") : undefined;

/** A skill's full text, or one of its reference files. */
export function skillText(s: Skill, file?: string): string {
	if (file) return s.files[file] ?? `Skill ${s.name} has no file "${file}". Files: ${Object.keys(s.files).join(", ") || "none"}.`;
	const files = Object.keys(s.files);
	return `Skill ${s.name}: ${s.description}\n\n${s.body}${files.length ? `\n\nReference files (read_skill with file): ${files.join(", ")}` : ""}`;
}

/** What the skill tools need from the Director, as RPC. */
export type SkillsApi = {
	skillCatalog(agent: string): Promise<string | undefined>;
	readSkill(agent: string, name: string, file?: string): Promise<string>;
	saveSkill(by: string, name: string, description: string, body: string, agents: string[]): Promise<string>;
	deleteSkill(by: string, name: string): Promise<string>;
	installSkill(by: string, url: string, agents: string[]): Promise<string>;
};

const reply = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export const skillsKit = (director: () => Promise<SkillsApi>, agent: string): Extension =>
	defineExtension({
		name: "skills",
		sections: [section("skills", async () => (await director()).skillCatalog(agent))],
		tools: [
			defineTool({
				name: "read_skill",
				description: "Read a skill from your skills list in full, or one of its reference files.",
				parameters: Type.Object({
					name: Type.String({ description: "Skill name from the list" }),
					file: Type.Optional(Type.String({ description: "A reference file the skill names" })),
				}),
				replay: "safe",
				execute: async ({ name, file }) => reply(await (await director()).readSkill(agent, name, file)),
			}),
			defineTool({
				name: "save_skill",
				description:
					"Save a skill: a format, checklist or way of working that agents follow whenever it applies. Use it when the operator gives " +
					"you one, or a brief asks you to write or improve one. It is live at once and announced to the operator, who can undo it. " +
					"Saving an existing name replaces that skill.",
				parameters: Type.Object({
					name: Type.String({ description: "lowercase-with-dashes, such as investor-memo-format; an existing name to replace it" }),
					description: Type.String({ description: "One line: what it is and when to use it; agents choose by this" }),
					body: Type.String({ description: "The complete instructions" }),
					agents: Type.Optional(Type.Array(Type.String(), { description: "Agents that may use it; leave out for every agent" })),
				}),
				replay: "safe",
				execute: async ({ name, description, body, agents }) => reply(await (await director()).saveSkill(agent, name, description, body, agents ?? [])),
			}),
			defineTool({
				name: "install_skill",
				description: "Install a skill from a URL the operator gives you: a SKILL.md file or a GitHub folder that holds one. Live at once and announced.",
				parameters: Type.Object({
					url: Type.String({ description: "https URL of a SKILL.md, or a github.com/.../tree/... folder" }),
					agents: Type.Optional(Type.Array(Type.String(), { description: "Agents that may use it; leave out for every agent" })),
				}),
				replay: "safe",
				execute: async ({ url, agents }) => reply(await (await director()).installSkill(agent, url, agents ?? [])),
			}),
			defineTool({
				name: "delete_skill",
				description: "Delete a skill saved in chat, when the operator asks. A skill that is also in the repo comes back from there.",
				parameters: Type.Object({ name: Type.String() }),
				replay: "safe",
				execute: async ({ name }) => reply(await (await director()).deleteSkill(agent, name)),
			}),
		],
	});
