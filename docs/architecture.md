# Architecture

```
Telegram ──webhook──▶ Worker (src/worker.ts) ──▶ Director (Durable Object "main")
                                                  │  topics, jobs, routines, budget, commands, buttons, digests
                                                  ├──▶ FleetAgent "lead"           the Lead (pi harness)
                                                  ├──▶ FleetAgent "research~42"    one worker per parallel job
                                                  ├──▶ Library     reports, pages, the private archive
                                                  ├──▶ Google      the sealed sign-in and the allow-list
                                                  └──▶ Repos       repo views uploaded by the home server
reports Worker (sites/reports) ──▶ Library     pages, behind Cloudflare Access
home server (optional) ──/sync/*──▶ Worker     archives to git, repo views, skills, deploys
```

## The pieces

- **Worker** (`src/worker.ts`): checks the Telegram webhook secret, the chat and that the sender is you, then hands the
  update to the Director. It also serves the Google sign-in callback and the home server's `/sync/*` routes (token
  checked).
- **Director** (`src/director.ts`, services in `src/director/`): one Durable Object that owns the shared state in its
  SQLite: jobs, routines, the spend ledger, projects, wishes, skills saved in chat, what was sent. Every 15 minutes a
  tick starts queued jobs, runs the digests and plugin ticks, and wakes stalled agents. The services are plain classes
  over small ports (`src/director/context.ts`), so tests run them over fakes.
- **FleetAgent** (`src/agent.ts`): one Durable Object per agent, running a pi agent harness
  (`@earendil-works/pi-durable`) on Claude through the Agents SDK. A job runs on its own instance, `<agent>~<job id>`, so an agent can work on
  several at once without mixing contexts. Each reports its spend per model to the Director after every answer and
  before every search; the Director refuses a turn the budget does not allow.
- **Library** (`src/library-object.ts`): the reports agents file (searchable with SQLite FTS5) and the HTML pages they
  publish; reports from agents that hold private data go to a separate private archive no agent can search.
- **Google** (`src/google/`): holds the OAuth refresh token sealed with AES-GCM and attaches access tokens only to
  requests `allow.ts` permits. Agents call it; they never see a token.
- **Repos** (`src/repos-object.ts`): files of a git repo on your server that an agent may read (with parts left out)
  and the writes it queued, which the server checks and commits.
- **reports Worker** (`src/site.ts`): serves published pages from the Library, only with a valid Cloudflare Access
  token, with headers that block scripts and outside loads.

## An agent

Its wiring is an entry in the fleet (core's in `src/fleet.ts`, the rest in plugins): model, effort, tools, MCP servers,
repo views, budget share, parallel jobs. Its contract is `roles/<agent>.md` in a fixed shape (Purpose, Owns, Does not,
Inputs, Output, Hand-offs, Ask when, Quality bar), always part of its instructions. Tools come in kits (pi extensions,
`src/toolkits.ts`); each tool declares its risks in the catalog (`src/tools.ts`), which the safety checks read.

## A job

The Lead's `dispatch` asks the Director for a job. The Director checks the budget and the safety of any chained inputs,
picks a worker, and sends the brief. When the agent answers, its report is filed, the spend recorded, and the result
routed by the job's kind: a request back to the Lead, a routine to the briefing, a button's job to you in one line,
a plugin's job to that plugin's hook.

## Plugins

A plugin is a folder under `plugins/` with a manifest (`src/plugin.ts`): agents, tools, kits, MCP servers, repo views,
a Director part with commands, buttons, briefing lines and job hooks, a tick, server steps. `pocketcrew.config.ts` lists
the enabled ones; the build compiles only those in (`src/plugins.gen.ts`). See [plugins.md](plugins.md).

## The home server

Optional, any always-on Linux machine. A cron runs `scripts/sync.mjs`: it pulls reports, pages and the crew's state from
the Worker into git repos, commits skills saved in chat back into this repo, applies agents' queued repo writes after
running the repo's own checks, uploads repo views and the git feed, and runs plugins' server steps. A push to `main`
of the bare repo deploys (`scripts/deploy.sh`) after `npm run check` passes. The cloud never holds git credentials.

## Configuration and secrets

`pocketcrew.config.ts` holds the owner's settings (`src/config.ts` lists each with its default). Secrets are Worker
secrets or entries in a Cloudflare Secrets Store; code reads them through `secret()` (`src/secrets.ts`), and the
Telegram token only through `bot(env)`.
