# Writing a plugin

Everything specific to a use is a plugin: an agent or two, their tools, maybe a command with buttons, maybe a step the
home server runs. Core stays the Lead, jobs, routines, the budget and the safety checks. This page builds a small
plugin from nothing; `plugins/lead-pipeline/` is a complete real one to read next to it.

## The folder

```
plugins/standup/
  plugin.ts            the manifest: what the plugin adds (required)
  roles/scribe.md      one contract per agent it adds (required for each agent)
  skill.md             its section of the crew skill, which every agent reads (required if it adds agents)
  skills/<name>/SKILL.md   how-to notes for its agents (optional)
  kit.ts, desk.ts, …   its code (optional)
  *.test.ts            its tests, run only when it is enabled
  server/              steps the home server runs (optional)
```

Enable it in `pocketcrew.config.ts`:

```ts
plugins: ["google", "web", "standup"],
```

`npm run check` bundles it (`src/plugins.gen.ts`, the skills and roles), type-checks, and runs the safety checks and
the tests. Then deploy, and send `/setup` in General so the new agent gets its topic.

## The manifest

```ts
// plugins/standup/plugin.ts
import { definePlugin } from "../../src/plugin.ts";
import { StandupDesk } from "./desk.ts";

export default definePlugin<StandupDesk>({
	name: "standup",                       // the folder's name
	about: "A daily standup note from what the crew did yesterday.",
	requires: [],                          // other plugins it needs, such as ["web"]
	agents: {
		scribe: {
			title: "Scribe",                   // its Telegram topic
			role: "specialist",
			does: "writes the daily standup note from yesterday's jobs", // what the Lead reads when routing
			model: "claude-haiku-5-5",
			effort: "low",
			tools: ["library_search", "library_read", "standup_save"],
			mcp: [],
			share: 0.03,                       // a weight in the daily budget, against the other agents' shares
			parallelJobs: 1,
			searchesPerJob: 0,
		},
	},
	tools: {
		standup_save: { kit: "standup", risks: [] }, // declare risks honestly: "private", "untrusted", "egress"
	},
	kits: {
		// Loaded lazily: the import runs only when an agent with one of its tools starts.
		standup: async (h) => (await import("./kit.ts")).standupKit(async (note) => (await h.director()).pluginRpc("standup", "save", { note, agent: h.agent })),
	},
	director: (host) => new StandupDesk(host),  // its part of the Director, built once
	tick: (desk) => desk.maybeStart(),          // every 15 minutes
	rpc: { save: (desk, args) => desk.save((args as { note: string }).note) },
	help: ["/standup: today's standup note"],
});
```

Rules the build enforces (`pluginProblems()` in `src/safety.ts`, and `scripts/bundle-plugins.mjs`):

- names are unique: an agent, tool, kit, MCP server, repo view, command or button prefix that core or another plugin
  already has is refused;
- every tool has risks and a kit that builds it; every agent names only tools, MCP servers and repo views that exist;
- an agent has `roles/<agent>.md` in the fixed shape, and the plugin has a `skill.md` naming its agents, tools and
  commands;
- the fleet as a whole passes the safety rule: no agent with private, untrusted and egress together;
- at most nine specialists in one fleet (`LIMITS.maxSpecialistsPerLead`): past that, one Lead routes badly, so turn a
  plugin off before adding one more.

And two rules of style that keep load order simple: the manifest is data, and plugin code never reads core's registries
(`FLEET`, `TOOLS`, `plugins()`) at module load, only inside functions.

## A tool

A kit is a function that returns a pi extension. Tools hold no state; they call the Director, the Library or Google
through the host they are given.

```ts
// plugins/standup/kit.ts
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

export const standupKit = (save: (note: string) => Promise<unknown>) =>
	defineExtension({
		name: "standup",
		tools: [
			defineTool({
				name: "standup_save",
				description: "Save today's standup note; the operator sees it in the morning briefing.",
				parameters: Type.Object({ note: Type.String({ description: "At most ten lines" }) }),
				replay: "safe",
				execute: async ({ note }) => ({ content: [{ type: "text", text: String(await save(note)) }] }),
			}),
		],
	});
```

`h.director().pluginRpc(name, method, args)` reaches your plugin's `rpc` in the Director. Pass `h.agent` along and
check it there when a call is meant for one agent only (see `only()` in `plugins/lead-pipeline/plugin.ts`).

## The Director part

`director(host)` gets core's services through `PluginHost` (`src/plugin.ts`). The extension points:

| | |
|---|---|
| `host.commands.register("standup", (arg) => …)` | a slash command in General |
| `host.commands.interceptors.push(async (text) => …)` | take a typed answer you are waiting for (return true) before it reaches the Lead |
| `host.buttons.register("u", (tap) => …)` | buttons whose data starts with `u:`; `tap.done(note)` answers and removes them |
| `host.jobs.create(key, agent, task, …)` | start a job; `host.jobs.onDone("standup:", (f) => …)` hears every job whose key starts so |
| `host.digests.top / waiting / health.push(() => lines)` | lines in the morning briefing |
| `host.reminders`, `host.reactions` | come-back-tomorrow and reaction hooks |
| `host.ctx.sql` | the Director's SQLite: create your own tables, prefixed with your plugin's short name |
| `host.ctx.secret(name)` | a secret, by name |
| `host.kv` | small values |
| `general(host.ctx, text, { buttons, silent })` | a message in General (`src/director/context.ts`) |

```ts
// plugins/standup/desk.ts
import { general } from "../../src/director/context.ts";
import type { PluginHost } from "../../src/plugin.ts";

export class StandupDesk {
	private readonly host: PluginHost;
	constructor(host: PluginHost) {
		this.host = host;
		host.ctx.sql("CREATE TABLE IF NOT EXISTS su_notes (day TEXT PRIMARY KEY, note TEXT NOT NULL)");
		host.commands.register("standup", () => general(host.ctx, this.today() ?? "No note yet today."));
		host.digests.top.push(() => [this.today()].filter((l): l is string => !!l));
	}
	private day = () => new Date(this.host.ctx.now()).toISOString().slice(0, 10);
	today(): string | undefined {
		return this.host.ctx.sql<{ note: string }>("SELECT note FROM su_notes WHERE day = ?", this.day())[0]?.note;
	}
	save(note: string) {
		this.host.ctx.sql("INSERT OR REPLACE INTO su_notes (day, note) VALUES (?, ?)", this.day(), note);
		return "saved";
	}
	async maybeStart() {
		if (this.today() || this.host.jobs.withKey("standup:", ["queued", "running"]).length) return;
		await this.host.jobs.create(`standup:${this.day()}`, "scribe", "Write today's standup note from yesterday's reports (library_search), then standup_save it.");
	}
}
```

## The role and the skill section

`roles/scribe.md` is the agent's contract, always in its instructions, at most 500 words, in these sections: Purpose,
Owns, Does not, Inputs, Output, Hand-offs, Ask when, Quality bar. Name only tools the agent has; the build checks.

`skill.md` is a few lines for the crew skill: what each agent does, its tools, your commands. Every agent reads it,
so the crew knows what you added.

## Tests

Put them in the plugin's folder. `testDirector(start, [plugin])` (`src/director/test-kit.ts`) builds the Director's
services over fakes (Telegram, agents, Google, the library) with your plugin on:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { testDirector } from "../../src/director/test-kit.ts";
import type { StandupDesk } from "./desk.ts";
import plugin from "./plugin.ts";

test("standup: the tick starts one job a day, and the note shows in /standup", async () => {
	const t = testDirector(undefined, [plugin]);
	const desk = t.s.plugin.part<StandupDesk>("standup")!;
	await desk.maybeStart();
	await desk.maybeStart();
	assert.equal(t.s.jobs.withKey("standup:", ["running"]).length, 1);
	desk.save("Shipped the release.");
	await t.s.commands.dispatch(t.text("/standup"));
	assert.equal(t.tg.last().text, "Shipped the release.");
});
```

A core test that uses a plugin's agents says so with `{ skip: needs("google") }` (`src/test-needs.ts`), so every
combination of plugins builds and passes; CI runs core alone and each plugin on its own.

## Server steps

A plugin that needs the home server (a git repo, a local program) lists modules in `server`; `scripts/sync.mjs` runs
them every minute or every 15 minutes, and they reach your `rpc` through `POST /sync/plugin/<name>/<method>` with the
server's token. Prefer the Director's storage when you can: a plugin without server steps works for everyone.
