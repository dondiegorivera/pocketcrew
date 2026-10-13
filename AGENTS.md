# pocketcrew

Claude agents that run on Cloudflare (Workers + Durable Objects, pi-durable via the Agents SDK `PiHarness`),
infer with Claude Haiku 5.5 on the operator's Anthropic API key, and are controlled from the operator's phone.

## Repository rules

- An instance's `origin` is a bare repo on its home server (`<gitRoot>/<name>.git`, pocketcrew.config.ts). Push
  branches there; `main` is the integration branch. The hook can also mirror pushes to a `github` remote as a backup.
- **A push to `main` deploys.** The hook runs `scripts/deploy.sh` from the pushed commit in the background: a clean
  clone (`~/<name>-deploy`), `npm ci` when the lockfile changed, `npm run check`, then the Worker and the reports
  site. A failed check deploys nothing. The outcome is said in General; the log is `~/.cache/<name>-deploy/deploy.log`.
  So run `npm run check` before pushing, and do not deploy by hand except to recover. `scripts/ci-setup.sh` installs it.

## Secrets

- The Anthropic API key, the Telegram bot token, webhook and sync secrets and the Google client never go into the repo,
  a `.env` on the server, or an agent transcript. The operator types them into `npm run secrets` (or `npm run google`).
- Where they live: `STORE_ID` in `src/secrets.ts` names the account's Cloudflare Secrets Store (secrets prefixed
  the instance's name in capitals, such as `POCKETCREW_`); empty means Worker secrets. `cloudflare.config.ts` binds either kind, and code reads every secret through
  `secret()`/`secrets()` (cached a few minutes for store reads, so a rotation needs no deploy). Telegram goes through
  `bot(env)`, which holds the token; nothing else touches it.
- `scripts/put-secrets.mjs` writes secrets to whichever place is configured, through RAM-only files, never argv.
- `SECRET_NAMES` (and `OPTIONAL_SECRETS`) in `src/secrets.ts` list the names; real values live only in Cloudflare.

## Cloudflare

- Use the project-local CLI: `npx cf ...`, signed in with `npx cf auth login` (an auth profile can be bound to this
  directory).
- Discover commands with `npx cf cli search "<task>"` and keep queries anonymous (no names, ids, domains).
- After a deploy, a Durable Object that keeps getting requests can go on running the previous code until it has been
  idle for a while. When checking a change through a diagnostic, wait a couple of minutes without polling it.

## Layout

| File | Role |
|---|---|
| `src/fleet.ts` | The fleet's wiring: one entry per standing agent (model, effort, tools, MCP servers, repo views, budget share, parallel jobs), the credit and limits. Data only |
| `src/safety.ts` | The safety rules on that wiring: `riskSet`, `reportsToLead`, `filesInLibrary`, `inputProblem`/`passesTo` (what chained jobs may carry), `fleetProblems()` and `roleProblems()` (run as tests) |
| `src/instructions.ts` | What every agent is told besides its role: the shared rules, how to answer a job (free text, or fixed fields for private agents), a routine's preamble |
| `roles/<agent>.md` | Each agent's contract, always in its instructions, in one fixed shape: Purpose, Owns, Does not, Inputs, Output, Hand-offs, Ask when, Quality bar; at most 500 words. Developer-only |
| `src/role-format.ts`, `scripts/bundle-roles.mjs`, `src/roles.gen.ts` | The role shape and its check; the bundler (runs before check, test and deploy); the generated bundle, committed, never edited |
| `src/tools.ts` | The tool catalog: every tool's kit and risks (private, untrusted, egress). Pure data; `fleetProblems()` checks agents against it |
| `src/toolkits.ts` | Builds an agent's tools from its fleet entry: the kits (pi extensions) holding its tools, plus its MCP servers |
| `src/agent.ts` | `FleetAgent` Durable Object: one instance per agent, plus `<agent>~<job id>` workers for parallel jobs; pi harness, job runs, spend reports, filing reports, `/trace` |
| `src/director.ts` | `Director` Durable Object ("main"): only the platform side (storage, schedules, the real Telegram, agents, Google and library behind ports) and the RPC surface; the work is in `src/director/` |
| `src/director/` | The Director's services, plain classes over the ports in `context.ts`: `jobs` (create, start, finish and route by kind through hooks), `spend` (credit, ledger, checks, /budget, /credit), `routines`, `wishes`, `projects`, `skills`, `digests` (briefing, inbox line, /today, health; features add lines), `buttons` (tap router by prefix), `reminders`, `reactions`, `commands` (message router; features register commands and text interceptors), `fleet` (topics, /model, /status, /setup), `onboarding` (/start: the setup checklist, with plugins' steps), `google` (mail watch, Needs you, /google, /docs), `inbox`, `sales`; `services.ts` wires them; `schema.ts` the tables; `test-kit.ts` fakes for `director.test.ts` |
| `src/lead.ts` | The Lead's kit: `dispatch`, `jobs`, `cancel_job`, projects and routines (Director RPC only) |
| `src/notes.ts` | The notes kit: `remember`/`forget`, kept in the agent's SQLite and rendered as a system prompt section |
| `src/library.ts` | The library store (SQLite FTS5) and its kit: `library_search`, `library_read` |
| `src/library-object.ts` | `Library` Durable Object ("main"): reports, pages, and the private archive |
| `src/vault.ts` | The private archive: reports of agents holding private data, kept for the server-only `<name>-private` repo; no agent searches it, and a report reaches an agent only as a chained job's input |
| `src/pages.ts` | Published pages: store, `publish_page` kit, the site's index, and the headers that block scripts and outside loads |
| `src/site.ts`, `sites/reports/` | The `reports` Worker (at `reportsUrl`): serves pages from the Library, only with a valid Cloudflare Access token (`src/access.ts`) |
| `src/mcp.ts` | MCP servers (`MCP_SERVERS`: URL, risks, allow-list, token secret) and the bridge to pi tools, via the Agents SDK MCP client |
| `src/routines.ts` | Routine crons, read in the owner's time zone (next run, matching, the move from UTC), and the brief each run gets |
| `src/skills.ts` | Skills: SKILL.md parsing, chat-saved skills (Director SQLite), the catalog section and `read_skill`/`save_skill`/`delete_skill` |
| `skills/<name>/` | Repo skills: `SKILL.md` (front matter `name`, `description`, optional `agents`, optional `editable: dev`) plus optional `.md`/`.txt` reference files |
| `skills/crew/` | The fleet described to its own agents (developer-only). `src/crew-skill.test.ts` fails until it names every agent, tool and command |
| `src/help.ts` | The `/help` text: every operator command |
| `src/skills.gen.ts` | Generated from `skills/` by `scripts/bundle-skills.mjs` (runs before check, test and deploy); committed, never edited |
| `src/skill-install.ts` | Fetching a skill from a URL (SKILL.md or a GitHub folder) for `install_skill` |
| `src/attachments.ts` | Text files sent in Telegram (.md, .txt, .csv, .json, .yaml, .html): read and passed on with the caption |
| `src/google/oauth.ts` | Google sign-in: consent URL, code exchange, refresh, revoke, and AES-GCM sealing of the refresh token (`GOOGLE_TOKEN_KEY`) |
| `src/google/allow.ts` | Every Google request the fleet may make (no send, trash, spam, delete or sharing; archiving only with a fleet label, so it can be undone; calendar never notifies guests; edits only to files the fleet created or the operator allowed, and only adding or replacing text, writing cells and adding tabs) and which agent reaches which part (`familiesOf`) |
| `src/google/connector.ts` | `Google` Durable Object ("main"): holds the sealed sign-in, attaches tokens to allowed requests only; agents never see a token; the files the fleet created and those the operator allowed (`/docs allow`) |
| `plugins/google/` | The google plugin: Mail, Calendar, Clerk; `kits/` (Gmail assembled from `kits/gmail/`, Calendar, Docs/Sheets/Drive, attachments, MIME); `desk.ts` (mail watch, Needs you, /google, /docs, today's calendar), `inbox.ts` (/inbox); inbox-rules and prep-tax-advisor. Core keeps the connector, the allow-list, OAuth and `files.ts` |
| `src/repo-views.ts` | Repo views: which files of a repo on the server an agent reads (with redactions) and which it may write, plus the checks that gate a write. Pure; shared with the sync |
| `src/repos.ts`, `src/repos-object.ts` | The uploaded views and queued writes (`Repos` Durable Object), and the repo kit: `repo_files`, `repo_read`, `repo_grep`, `repo_write` |
| `src/git-feed.ts` | The git feed for Ops: followed repos (`devRepos` in pocketcrew.config.ts), secret scrubbing before upload, the commit store and `git_repos`/`git_log`/`git_show`/`git_branches` (read-only) |
| `plugins/ops/sites.ts` | Website traffic from Cloudflare's analytics API (`CF_ANALYTICS_TOKEN`, the sites' account): overview, per-site days, spikes; counts only, no referrers |
| `src/handover.ts` | `send_copy`: text for the operator to paste elsewhere (LinkedIn, forms), as its own Telegram message |
| `src/budget.ts` | Pacing: credit left ÷ days to expiry, capped at a multiple of the even pace; agent shares, reserve; the pace line |
| `src/wishes.ts` | The wishlist: one-off jobs the Director runs one at a time when quiet days leave credit unspent |
| `src/jobs.ts` | Splitting a job answer into title, report and the Lead's summary; a private job's fixed status fields and the Lead's line for it; report file names |
| `src/lazy.ts` | Registries built on first use (`FLEET`, `TOOLS`, `KITS`, `MCP_SERVERS`, `REPO_VIEWS`, and `plugins()`, `specialists()`, `help()` as functions): plugins import core, so nothing may read a plugin while modules load |
| `src/plugin.ts`, `src/plugins.gen.ts` | The plugin manifest type and host; the generated list of enabled plugins |
| `pocketcrew.config.ts`, `src/config.ts`, `scripts/config.mjs`, `scripts/lib.sh` | The owner's settings (plugins, time zone, quiet hours, digest hours, credit, URLs, the reports site's Access ids, per-agent overrides, followed repos, git root, backup folder); every setting with its default; one setting for shell scripts; Node 22 and `setting` for them |
| `scripts/backup.sh`, `scripts/backup-setup.sh` | Nightly mirrors of every bare repo to the backup folder (`backupDir` in pocketcrew.config.ts), 30 days of bundles for notes and the private archive; the sync reports a stale backup in the briefing |
| `src/reactions.ts` | Reactions as a vocabulary (❤️👍 more, 👎 less, ✍ notes, 👀 tomorrow, 🤔 plainer, 🙈 less of this kind), which message was whose (`sent`), and the operator-feedback text each agent gets (its prompt section and its jobs' briefs). `/inbox` (mail one at a time with buttons) lives in the Director |
| `src/digest.ts` | What reaches the phone and how loudly: which finished jobs the Lead hears of (requests yes; routines and mail triage no), the 10:00 briefing of the routines, the 18:00 inbox line, `/today`, routines whose pages went unopened for two weeks (opens counted by the reports site). Silent sends and quiet hours (22–07) are in `telegram.ts` |
| `src/trace.ts` | `/trace`: a transcript's last steps as short lines |
| `src/sql.ts`, `src/test-sql.ts` | The `Sql` shape the stores use; node:sqlite behind it for tests |
| `src/worker.ts` | Entry: Telegram secret, chat id and operator checks, then the Director; `GET /telegram/webhook` re-points the webhook; `GET /library/export` |
| `src/anthropic.ts` | pi-ai provider for Haiku, Sonnet and Opus 5.5 (not in pi-ai's catalog), prices, compaction windows |
| `src/web.ts` | `web_search` (its own Messages API call with Anthropic's web search tool) and `web_fetch` |
| `src/telegram.ts` | Bot API helpers, file sending |
| `src/voice.ts` | Voice notes: Telegram file → Workers AI Whisper → text, routed like a typed message |
| `scripts/setup.sh`, `scripts/setup-config.mjs` | `npm run setup`: a new instance from a clone, step by step (settings written to pocketcrew.config.ts, then secrets.sh --first) |
| `scripts/secrets.sh` | Operator-only: reads secrets from the keyboard, deploys, registers the webhook |
| `scripts/google-secrets.sh` | Operator-only (`npm run google`): the Google OAuth client id and secret from the keyboard, then a deploy |
| `scripts/library-setup.sh` | Once: the `<name>-research` bare repo + GitHub mirror, the server-only `<name>-private` repo, their working copies, the `~/<name>-sync` clone, the export token, the cron line |
| `src/dashboard/` | The operator's read-only dashboard on the tailnet (port 8341): overview, board, roles, skills, documents (reports rendered from Markdown, pages sandboxed), activity, deploys. Reads disk only: the deployed clone, both archives, the deploy state |
| `deploy/systemd/dashboard.service` | The dashboard's user unit (a template, installed as `<name>-dashboard`), served from `~/<name>-deploy`; every deploy restarts it |
| `scripts/deploy.sh`, `scripts/hooks/post-receive`, `scripts/ci-setup.sh` | Continuous deployment: the hook runs the pushed commit's deploy.sh after every push to main; ci-setup installs the hook and points the sync cron at `~/<name>-deploy` |
| `src/sync-export.ts` | `GET /library/export`, `/library/pages`, `/library/skills`: what `scripts/sync.mjs` pulls, behind `LIBRARY_EXPORT_TOKEN` |
| `src/skill-format.ts` | SKILL.md parsing and writing, limits, and the newer-copy-wins rule; no dependencies, so the bundler and sync run on plain node |
| `plugins/notes/` (`server/notes-setup.sh`, `server/notes-git-server.mjs`, `server/notes-password.mjs`; `scripts/notes-git-server.mjs` only starts it, for the installed unit) | The operator's notes: once, the server-only `notes` repo and its working copy (the `notes` repo view); git over HTTPS on the tailnet for Obsidian (`tailscale serve` in front of a localhost smart-HTTP server, `plugins/notes/server/notes-git.service`); the operator's password, typed in, stored as a hash |
| `scripts/sync.mjs`, `scripts/sync/` | The runner and one module per step (`archives`, `skills`, `repos`, `sales`, `git`, `health`, with `lib` shared). Cron, every 15 min: library reports and pages → `<name>-research`; skills saved in chat → `skills/` on the code repo's `main` (from `~/<name>-sync`); repo views: agents' writes applied one by one in `~/<repo>`, checked, committed or reverted, then the view re-uploaded; git feed: new commits of the followed repos, scrubbed, uploaded (read-only on the repos). `--minute`: only the views marked `everyMinute` and the plugins' minute steps, every minute, under the same lock |

## Plugins

Everything specific to a use is a plugin under `plugins/<name>/` (guide: `docs/plugins.md` in the public repo): a manifest
(`plugin.ts`, `definePlugin` from `src/plugin.ts`: agents, tools, kits, MCP servers, repo views, a Director part, rpc,
server steps, help, `requires` for plugins it builds on), its roles, skills, its section of the crew skill (`skill.md`), optional code and tests.
`pocketcrew.config.ts` lists the enabled ones; `scripts/bundle-plugins.mjs` writes `src/plugins.gen.ts` (and checks the
files), the skill and role bundlers add the plugins' skills, roles and skill sections, and core merges them into
`FLEET`, `TOOLS`, `KITS`, `MCP_SERVERS` and `REPO_VIEWS`. `pluginProblems()` (safety.ts, run as a test) refuses
collisions and dangling names; the Director refuses a taken command, button prefix or job-key prefix.
Rules: a manifest is data; kits load lazily (dynamic `import()` inside the factory); plugin code never uses core's
registries while modules load. A plugin's Director part gets the `PluginHost` (core's services and their extension
points: `commands.register`, `commands.interceptors`, `buttons.register`, `jobs.onDone`, `digests.waiting/health`,
`reminders.shows`, `tick`), and the home server reaches it through `POST /sync/plugin/<name>/<method>`.
The plugins here: `google` (Mail, Calendar, Clerk, /inbox, /google, /docs), `web` (Research, Radar, the research MCP
servers), `notes` (Notes, Obsidian), `ops` (Ops, git and traffic tools), `lead-pipeline` (Prospector, Closer, /leads;
needs `web`). Core alone is the Lead.

## Adding things

- A tool: implement it in its kit, add it to `TOOLS` in tools.ts with honest risks, name it in an agent's `tools`, and
  describe it in `skills/crew/SKILL.md` (the test names what is missing). The same goes for agents and commands.
- Any change agents should know about (limits, budget rules, where things are stored, how jobs, routines, wishes or
  deploys run): update `skills/crew/SKILL.md` in the same commit. The test only catches missing names, not changed
  behaviour, so ask "would an agent act differently knowing this?" before committing.
- An owner setting (a URL, path, time zone, hour, name): a field of `Config` in src/config.ts with its default, set in
  pocketcrew.config.ts and read through `CONFIG` (shell scripts: `setting <key>` from scripts/lib.sh). Never hard-code one.
- The changelog: a change someone running pocketcrew would notice adds a line under `## Unreleased` in `CHANGELOG.md`,
  in the same commit.
- A test: core tests run in any build, so one that uses a plugin's agents or tools says so with
  `{ skip: needs("google") }` (src/test-needs.ts); a plugin's own tests live in its folder and run only when it is on.
- A kit: a function returning a pi extension, registered in `KITS` (toolkits.ts).
- An MCP server: see the steps at the top of src/mcp.ts. `/mcp` lists what a server offers; only `allow` reaches agents.
- An agent: an entry in `FLEET` (the wiring) and `roles/<name>.md` (the contract, in the fixed sections), `npm run check`,
  push, `/setup` in General. `roleProblems()` refuses a missing role, a wrong shape, or a role naming a tool the agent lacks.
- Behaviour: what an agent is for and must not do goes in its role file; how to do a particular task (formats,
  procedures, checklists) goes in a skill. Skills can be made in chat; roles cannot, and no skill widens a role.
- A repo view: an entry in `REPO_VIEWS` (repo-views.ts) with honest risks, what to leave out, what may be written and the
  repo's own checks; the repo's working copy at `~/<repo>` as the user the sync runs as; the view's name in an agent's `repos`.
- A skill: a folder `skills/<name>/` with a `SKILL.md`, then `npm run deploy`; or in chat: the Lead saves what the
  operator gives it, Research saves skills it is asked to write (`save_skill`), and the Lead installs one from a URL
  (`install_skill`). A save is live at once, with no approval step: the Director announces each one in General with
  `/skills show <name>` and `/skills undo <name>` (every replaced version is kept). Skills from outside text (a URL, an
  agent that reads the web) are scoped away from the Lead (`skillScope`). Agents see the catalog and read a skill when
  it applies; the Lead can attach skills to a dispatch or routine. A repo skill with `editable: dev` (such as `crew`)
  changes only here: chat saves, installs and deletes of it are refused, and no chat copy overrides it.
  Skills saved in chat are committed to `skills/` on `main` by the server's sync within 15 minutes (with an `updated`
  stamp); after the next deploy the bundled copy takes over and the Director drops its own. So: `git pull` before
  working here, and expect "Skills from chat" commits.

The research library is one way: Cloudflare (what agents search) → git (the archive). Edits in the repo do not flow back.
Reports of agents that hold private data, private pages, and the Director's state (projects, routines, wishes, jobs, the
Lead's notes, spend by day) go to `<name>-private`, a bare repo on the home server with no GitHub mirror.
Published pages follow the same path: Library → reports Worker for reading, and `pages/` in the archive repo.

## Commands

```sh
npm run setup    # a new instance, step by step: Node, Cloudflare sign-in, settings, Telegram, secrets, deploy, webhook
npm run check    # cf workers types + tsc + unit tests (fleetProblems() runs as a test)
npm test         # scripts/test.mjs: core's tests and the enabled plugins', on fixed test settings
git push origin main  # deploys: the hook runs scripts/deploy.sh (checks, Worker, reports site) and says so in General
npm run deploy   # by hand, only to recover; code only, secrets stay as they are
npm run deploy:site  # the reports Worker (sites/reports)
npm run secrets  # the operator, in a terminal: secrets + deploy + webhook
```

## Budget

The credit (`credit` in pocketcrew.config.ts, or `/credit` at runtime) is a promotional grant with an expiry. Each day the fleet may
spend what was left at the start of the day divided by the days to expiry, but at most 1.5× the even pace (the credit as
read, spread over its whole period; 2.5× in the final week), so credit saved up by quiet days cannot land on one late day;
each agent up to twice its share of that. What quiet days leave unspent shows in `/budget` and runs the wishlist
(`/wish [agent] [haiku|sonnet|opus] <task>`, the Lead's `add_wish`), one job at a time, outside the agent's own cap but
inside the fleet's day. A wish that names a model runs on its own worker with that model; the agent keeps its own.
Models never change on their own; the operator switches an agent with `/model`.
Agents report spend per model to the Director after every answer and before every search; the Director checks before
every new turn, job and search. `LIMITS.reserveUsd` is never spent, so an exhausted credit does not turn into card
charges. A run already going is not cut off mid-way.

## Safety rules for new agents

- Never give one agent private data (mail, calendar, docs, notes), content from strangers (web, mail, MCP answers) and
  a way out (web fetch, search queries, sending, dispatching) together. Split the work across agents instead.
  `fleetProblems()` enforces this from the risks in tools.ts and mcp.ts, so label new tools honestly.
- No agent gets a tool that sends email or deletes anything. Drafts and approvals instead. For MCP servers, that means
  such tools stay out of `allow`.
- The Lead reads no web or third-party content; it routes, keeps notes and manages projects and routines.
- Agents that read private data written by others (Mail, Calendar, Clerk) report to the operator only: the Lead gets
  three checked fixed fields (status, a count, a suggested next agent; `PRIVATE_JOB_INSTRUCTIONS`, `parseStatus`), never
  free text (`reportsToLead`), and no agent holding private data files reports in the research library
  (`filesInLibrary`), which web agents read and git archives.
- Chained jobs (dispatch `inputs`) carry full reports from job to job without the Lead reading them. `inputProblem()`
  (safety.ts) decides what may flow where: a private result only to private agents without a way out, and nothing that
  would give an agent private data, strangers' text and a way out together. Clerk is the private desk for work that
  spans mail, documents and the calendar.
- Google access goes only through the connector and `allow.ts`; a new Google capability is a new allow rule plus a tool,
  never a token handed to an agent.
