// The Lead's tools. They only talk to the Director: the Lead plans and routes, it touches no data and no web.
import { CONFIG, ZONE_NAME } from "./config.ts";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { FLEET, specialists } from "./fleet.ts";
import { roleOf } from "./instructions.ts";
import { boundaries, parseRole } from "./role-format.ts";

/** What the Lead's tools need from the Director, as RPC. */
export type DirectorApi = {
	createJob(key: string, agent: string, task: string, project?: string, skills?: string[], model?: undefined, inputs?: number[]): Promise<string>;
	listJobs(): Promise<string>;
	cancelJob(id: number): Promise<string>;
	saveProject(name: string, goal: string, context: string): Promise<string>;
	listProjects(): Promise<string>;
	saveRoutine(name: string, agent: string, cron: string, task: string, project?: string, skills?: string[], model?: string): Promise<string>;
	listRoutines(): Promise<string>;
	cancelRoutine(id: number): Promise<string>;
	moveRoutine(id: number, cron: string): Promise<string>;
	addWish(key: string, agent: string, task: string, project?: string, model?: string): Promise<string>;
	listWishes(): Promise<string>;
	dropWish(id: number): Promise<string>;
	/** A plugin's Director part (plugin.ts `rpc`), for that plugin's own kits. */
	pluginRpc(name: string, method: string, args: unknown): Promise<unknown>;
};

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** One specialist for the dispatch tool: what it does, and the first of its role's limits, so routing respects them. */
const specialistLine = (n: string) => {
	const role = parseRole(roleOf(n));
	return `${n}: ${FLEET[n].does}${typeof role === "string" ? "" : ` (never: ${boundaries(role)})`}`;
};

/** The Lead's routing tools; they reach nothing but the Director. */
export const leadKit = (director: () => Promise<DirectorApi>): Extension =>
	defineExtension({
		name: "lead",
		tools: [
			defineTool({
				name: "dispatch",
				description:
					"Hand a job to a specialist. It runs in the background; its result comes back to you as a message starting with [job #n]. " +
					"Specialists: " +
					specialists().map(specialistLine).join(" | "),
				parameters: Type.Object({
					agent: Type.Union(specialists().map((n) => Type.Literal(n))),
					task: Type.String({ description: "The complete brief: goal, context, what to deliver, limits. The specialist sees only this and the project card." }),
					project: Type.Optional(Type.String({ description: "Name of a saved project card this job belongs to" })),
					skills: Type.Optional(Type.Array(Type.String(), { description: "Skills the job must follow; their full text goes with the brief" })),
					inputs: Type.Optional(
						Type.Array(Type.Integer(), {
							description:
								"Finished jobs whose full reports the specialist gets with the brief, so work builds on work you need not read yourself " +
								"(Mail finds, then Clerk cross-checks). Private results may go only to agents without a way out; the answer says when not.",
						}),
					),
				}),
				// The tool task's id makes the job key, so a rerun after an eviction finds the job instead of starting it twice.
				replay: "safe",
				execute: async ({ agent, task, project, skills, inputs }, api) =>
					text(await (await director()).createJob(`dispatch:${api.taskId}`, agent, task, project, skills, undefined, inputs)),
			}),
			defineTool({
				name: "jobs",
				description: "List open and recent jobs with their status, age and cost.",
				parameters: Type.Object({}),
				replay: "safe",
				execute: async () => text(await (await director()).listJobs()),
			}),
			defineTool({
				name: "cancel_job",
				description: "Stop a queued or running job.",
				parameters: Type.Object({ id: Type.Integer({ description: "Job number" }) }),
				replay: "safe",
				execute: async ({ id }) => text(await (await director()).cancelJob(id)),
			}),
			defineTool({
				name: "save_project",
				description:
					"Create or update a project card. Jobs for the project carry it, so specialists know the goal and background. " +
					"Use it when the operator describes a project or its goal changes.",
				parameters: Type.Object({
					name: Type.String({ description: "Short name, such as price-tracker" }),
					goal: Type.String({ description: "What the project is for, in one or two sentences" }),
					context: Type.String({ description: "Background a specialist should assume: audience, constraints, where results go" }),
				}),
				replay: "safe",
				execute: async ({ name, goal, context }) => text(await (await director()).saveProject(name, goal, context)),
			}),
			defineTool({
				name: "list_projects",
				description: "List the saved project cards.",
				parameters: Type.Object({}),
				replay: "safe",
				execute: async () => text(await (await director()).listProjects()),
			}),
			defineTool({
				name: "schedule_routine",
				description:
					"Save a routine: a job that runs again and again on a schedule, such as research every morning. Each run is a normal job " +
					"whose result comes back to you as [job #n]; the specialist sees the previous runs in the library and reports what changed. " +
					`The cron is in the operator's local time, ${CONFIG.timeZone} (minute hour day month weekday), and keeps that wall-clock ` +
					"time through summer and winter time; at most hourly. The answer gives the next run.",
				parameters: Type.Object({
					name: Type.String({ description: "Short name, such as morning-ai-news" }),
					agent: Type.Union(specialists().map((n) => Type.Literal(n))),
					cron: Type.String({ description: `${ZONE_NAME}-time cron with a fixed minute, such as 0 7 * * 1-5 for 07:00 on weekdays` }),
					task: Type.String({ description: "The complete brief for every run" }),
					project: Type.Optional(Type.String({ description: "Name of a saved project card" })),
					skills: Type.Optional(Type.Array(Type.String(), { description: "Skills every run must follow" })),
					model: Type.Optional(Type.Union([Type.Literal("haiku"), Type.Literal("sonnet"), Type.Literal("opus")], { description: "Only when the operator names one: the model for every run. Otherwise the agent's own." })),
				}),
				replay: "safe",
				execute: async ({ name, agent, cron, task, project, skills, model }) => text(await (await director()).saveRoutine(name, agent, cron, task, project, skills, model)),
			}),
			defineTool({
				name: "routines",
				description: "List the saved routines with their schedule and last run.",
				parameters: Type.Object({}),
				replay: "safe",
				execute: async () => text(await (await director()).listRoutines()),
			}),
			defineTool({
				name: "move_routine",
				description:
					"Give a routine a new time, in place: its brief, agent, model, skills, project and run history stay exactly as they are. " +
					"Use this to reschedule; never delete and recreate a routine for that. The cron is in the operator's local time, as for schedule_routine.",
				parameters: Type.Object({
					id: Type.Integer({ description: "Routine number" }),
					cron: Type.String({ description: `${ZONE_NAME}-time cron with a fixed minute, such as 15 4 * * * for 04:15 every day` }),
				}),
				replay: "safe",
				execute: async ({ id, cron }) => text(await (await director()).moveRoutine(id, cron)),
			}),
			defineTool({
				name: "cancel_routine",
				description: "Delete a routine so it no longer runs. Jobs it already started are not affected.",
				parameters: Type.Object({ id: Type.Integer({ description: "Routine number" }) }),
				replay: "safe",
				execute: async ({ id }) => text(await (await director()).cancelRoutine(id)),
			}),
			defineTool({
				name: "add_wish",
				description:
					"Put a one-off job on the operator's wishlist: work they want done some time, not now. The Director starts wishes one at a " +
					"time, oldest first, when quiet days leave credit unspent, so the credit is used instead of lapsing; the result comes back " +
					"to you as [job #n]. Use it when the operator says 'some time', 'when there is budget' or /wish-like requests.",
				parameters: Type.Object({
					agent: Type.Union(specialists().map((n) => Type.Literal(n))),
					task: Type.String({ description: "The complete brief, as for dispatch" }),
					project: Type.Optional(Type.String({ description: "Name of a saved project card" })),
					model: Type.Optional(Type.Union([Type.Literal("haiku"), Type.Literal("sonnet"), Type.Literal("opus")], { description: "Only when the operator names one: the model for this wish alone. Otherwise the agent's own." })),
				}),
				// Keyed by the tool task like dispatch, so a rerun after an eviction does not add the wish twice.
				replay: "safe",
				execute: async ({ agent, task, project, model }, api) => text(await (await director()).addWish(`lead:${api.taskId}`, agent, task, project, model)),
			}),
			defineTool({
				name: "wishes",
				description: "List the wishlist: waiting wishes and recently started ones, and how much credit is spare.",
				parameters: Type.Object({}),
				replay: "safe",
				execute: async () => text(await (await director()).listWishes()),
			}),
			defineTool({
				name: "drop_wish",
				description: "Remove a wish that has not started.",
				parameters: Type.Object({ id: Type.Integer({ description: "Wish number" }) }),
				replay: "safe",
				execute: async ({ id }) => text(await (await director()).dropWish(id)),
			}),
		],
	});
