// Project cards: a name, a goal and background that every job for that project carries.
import type { ProjectCard } from "../agent.ts";
import type { Ctx } from "./context.ts";

export class Projects {
	private readonly ctx: Ctx;
	constructor(ctx: Ctx) {
		this.ctx = ctx;
	}
	get(name: string): ProjectCard | undefined {
		return this.ctx.sql<ProjectCard>("SELECT name, goal, context FROM projects WHERE name = ?", name)[0];
	}
	save(name: string, goal: string, context: string): string {
		this.ctx.sql("INSERT OR REPLACE INTO projects VALUES (?, ?, ?, ?)", name, goal, context, this.ctx.now());
		return `Project card "${name}" saved.`;
	}
	list(): string {
		const rows = this.ctx.sql<ProjectCard>("SELECT name, goal, context FROM projects ORDER BY name");
		return rows.length ? rows.map((p) => `${p.name}: ${p.goal}\n   ${p.context}`).join("\n") : "No project cards yet.";
	}
	all() {
		return this.ctx.sql("SELECT name, goal, context, updated FROM projects ORDER BY name");
	}
}
