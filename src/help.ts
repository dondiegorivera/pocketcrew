// The /help text: every operator command in one place, core's and the enabled plugins'. Pure, so the crew skill test
// can check the skill names them all.
import { plugins } from "./plugins.gen.ts";

const CORE_HELP = [
	"Write to the Lead here in General; it hands work to the specialists and reports back.",
	"",
	"Commands:",
	"/today: the day so far in one message · /jobs: open and recent jobs · /cancel <n>: stop a job",
	"/status: what each agent is doing · /budget: credit, today's allowance, how it is set · /budget lift [all|off]",
	"/model: models in use · /model <agent> <haiku|sonnet|opus>: switch one",
	"/credit <usd> <YYYY-MM-DD>: the Console's remaining credit and its expiry, after a new grant",
	"/projects: saved project cards · /routines: scheduled jobs · /routines stop <n> · /routines move <n> <cron>: a new time, brief kept",
	"/wish [agent] [haiku|sonnet|opus] <task>: a job to run when quiet days leave credit spare · /wishes · /wishes drop <n>",
	"/library [words]: newest reports, or a search · /notes: the Lead's standing notes",
	"/trace <agent>: the agent's last steps, errors included · /mcp: MCP servers and their tools",
	"/skills: the skills agents use · /skills show <name>: its text · /skills undo <name>: back one version",
	"Send a .md or .txt file to hand an agent a spec or a skill.",
	"/stop, /pause, /resume <agent|all> · /reset <agent>: fresh context",
	"/setup: create a topic for every specialist in fleet.ts · /start: the setup checklist, with a button for each open step",
	"",
	"In a specialist's topic, plain text talks to it directly; /stop, /pause, /resume, /reset, /status, /trace and /notes act on it.",
	"Reactions on any fleet message: ❤️/👍 more like this · 👎 less · ✍ save to notes · 👀 back tomorrow · 🤔 say it plainer · 🙈 stop showing me this kind",
];

/** Plugins' lines go after the commands, before the closing notes on topics and reactions. */
export const help = (): string => [...CORE_HELP.slice(0, -3), ...plugins().flatMap((p) => p.help ?? []), ...CORE_HELP.slice(-3)].join("\n");
