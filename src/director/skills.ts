// Skills as the Director keeps them: the repo's bundled ones and those saved in chat (newer copy wins), what each agent
// may see, saving, installing and deleting from chat (never a developer-only skill), and the /skills command.
import { baseName, FLEET, isAgentName, LEAD } from "../fleet.ts";
import { catalogText, mergeSkills, type Skill, skillMarkdown, skillProblem, skillScope, SkillsStore, skillText, superseded, visibleTo } from "../skills.ts";
import { fetchSkill } from "../skill-install.ts";
import { risksOf } from "../tools.ts";
import { type Ctx, general } from "./context.ts";

export class Skills {
	readonly store: SkillsStore;
	private readonly ctx: Ctx;
	private readonly bundled: readonly Skill[];
	constructor(ctx: Ctx, bundled: readonly Skill[]) {
		this.ctx = ctx;
		this.bundled = bundled;
		this.store = new SkillsStore(ctx.sql);
	}

	/** After a deploy: chat skills the server's sync committed are now bundled; the repo copy takes over. */
	dropSuperseded() {
		for (const name of superseded(this.bundled, this.store.list())) this.store.remove(name);
	}

	all(): Skill[] {
		return mergeSkills(this.bundled, this.store.list());
	}
	get(name: string): Skill | undefined {
		return this.all().find((s) => s.name === name);
	}
	/** Why `agent` cannot carry these skills, or undefined. */
	unusable(agent: string, names: readonly string[]): string | undefined {
		const bad = names.filter((n) => !this.get(n) || !visibleTo(this.get(n)!, agent));
		return bad.length ? `${agent} has no skill ${bad.join(", ")}. Skills: ${this.all().filter((s) => visibleTo(s, agent)).map((s) => s.name).join(", ") || "none"}.` : undefined;
	}
	texts(names: readonly string[]): string[] {
		return names.flatMap((n) => {
			const s = this.get(n);
			return s ? [skillText(s)] : [];
		});
	}

	catalog(agent: string): string | undefined {
		return catalogText(this.all().filter((s) => visibleTo(s, baseName(agent))));
	}
	read(agent: string, name: string, file?: string): string {
		const s = this.get(name);
		if (!s || !visibleTo(s, baseName(agent))) return `No skill "${name}" for you. ${this.catalog(agent) ?? "You have no skills."}`;
		return skillText(s, file);
	}

	private scope(agents: string[], outside: boolean) {
		return skillScope(agents, outside, { all: Object.keys(FLEET), lead: LEAD });
	}

	/** Why chat may not change skill `name`, or undefined: skills marked `editable: dev` change only in the repo. */
	private devOnly(name: string): string | undefined {
		if (this.bundled.some((b) => b.name === name && b.devOnly))
			return `"${name}" is maintained by the developer in the repo and cannot be changed from chat. Write the change as a short brief for the operator to pass on.`;
	}

	/** Saves and tells the operator in one line, with the commands to look at it or take it back. */
	private async adopt(s: Omit<Skill, "source">, by: string): Promise<string> {
		const locked = this.devOnly(s.name);
		if (locked) return `Not saved: ${locked}`;
		s = { ...s, devOnly: undefined }; // only the repo marks a skill developer-only
		const replaced = this.get(s.name) !== undefined;
		this.store.save(s);
		const verb = replaced ? "updated" : "added";
		await general(this.ctx, `🧩 ${by} ${verb} the skill "${s.name}" (${s.agents.length ? s.agents.join(", ") : "every agent"}): ${s.description}\n/skills show ${s.name} · /skills undo ${s.name}`);
		return `Skill "${s.name}" ${verb}; it is live now and reaches the repo within 15 minutes.`;
	}

	async save(by: string, name: string, description: string, body: string, agents: string[]): Promise<string> {
		const who = baseName(by);
		const s = skillProblem({ name, description: description.trim(), agents, body: body.trim() });
		if (typeof s === "string") return `Not saved: ${s}`;
		const outside = isAgentName(who) && risksOf(FLEET[who].tools).has("untrusted");
		const scope = this.scope(agents, outside);
		if (typeof scope === "string") return `Not saved: ${scope}`;
		return this.adopt({ ...s, agents: scope, files: {}, ...(who === LEAD ? {} : { origin: who }) }, who);
	}

	async install(by: string, url: string, agents: string[]): Promise<string> {
		const scope = this.scope(agents, true);
		if (typeof scope === "string") return `Not installed: ${scope}`;
		const got = await fetchSkill(url);
		if (typeof got === "string") return `Not installed: ${got}`;
		return this.adopt({ ...got, agents: scope, origin: url }, `${baseName(by)}, from ${url},`);
	}

	async remove(by: string, name: string): Promise<string> {
		const locked = this.devOnly(name);
		if (locked) return `Not deleted: ${locked}`;
		const inRepo = this.bundled.some((b) => b.name === name);
		if (!this.store.remove(name)) return inRepo ? `"${name}" is in the repo; remove skills/${name} there and deploy.` : `No skill "${name}".`;
		const back = inRepo ? " The repo's version applies again." : "";
		await general(this.ctx, `🧩 ${baseName(by)} deleted the skill "${name}".${back}\n/skills undo ${name}`);
		return `Skill "${name}" deleted.${back}`;
	}

	/** `/skills`, `/skills show <name>`, `/skills undo <name>`. */
	async command(arg: string) {
		const [verb, name] = arg.split(/\s+/);
		if (verb === "undo" && name) {
			const r = this.store.undo(name);
			return general(
				this.ctx,
				r === "restored" ? `↩️ "${name}" is back to its previous version.` : r === "removed" ? `↩️ The saved "${name}" is gone${this.bundled.some((b) => b.name === name) ? "; the repo's version applies again" : ""}.` : `Nothing to undo for "${name}".`,
			);
		}
		if (verb === "show" && name) {
			const s = this.get(name);
			if (!s) return general(this.ctx, `No skill "${name}".`);
			const files = Object.keys(s.files);
			const text = [skillMarkdown({ ...s, origin: undefined, updated: undefined }), ...files.map((f) => `\n===== reference file ${f} =====\n\n${s.files[f]}`)].join("");
			return (await this.ctx.tg()).sendFile(undefined, `${name}.SKILL.md`, text, `🧩 ${name} (${s.source}${s.origin ? `, from ${s.origin}` : ""})`);
		}
		const all = this.all();
		if (!all.length) return general(this.ctx, "No skills yet. Add a folder under skills/ in the repo, or give the Lead one in chat.");
		return general(this.ctx, all.map((s) => `🧩 ${s.name} (${s.source}${s.origin ? ` · ${s.origin}` : ""}; ${s.agents.length ? s.agents.join(", ") : "every agent"})\n   ${s.description}`).join("\n") + "\n\n/skills show <name> · /skills undo <name>");
	}
}
