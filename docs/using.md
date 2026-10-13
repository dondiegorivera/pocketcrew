# Using it

Everything happens in your Telegram group. General is where you talk to the Lead; each specialist has its own topic.

## Talking to the crew

- **In General**, write as you would to an assistant: "find three papers on X and summarise them", "every weekday at
  7 send me AI news", "draft a reply to the mail from the bank". The Lead plans, hands the work to a specialist as a
  job, and tells you when it is done. Voice notes are transcribed and handled the same way.
- **In a specialist's topic**, plain text goes to that agent directly.
- **Files:** send a `.md`, `.txt`, `.csv`, `.json`, `.yaml` or `.html` file with a caption to hand an agent a spec or a
  skill.

A job's result arrives as a short message: a title that says what happened, and a link when there is a page to read.

## What arrives, and how loudly

| Message | When | Sound |
|---|---|---|
| The Lead's answers | when you ask | yes |
| ☀️ Morning briefing | at `briefingHour` (10:00): today's calendar, each routine's result, what waits on you, anything broken | yes |
| 📬 Needs you | a mail that needs you (google plugin) | yes |
| ⚡ Alert | an agent's time-critical find, at most one a day each | yes |
| Routine results after the briefing, the 18:00 inbox line, 🧾 the nightly cost line | | silent |

Nothing makes a sound during `quietHours` (22:00–07:00 by default).

## Decisions with buttons

Some work comes as one decision at a time, with buttons, so you can clear it on the phone:

- `/inbox` (google): your inbox mail one at a time: reply draft, archive, label, later.
- `/leads` (lead-pipeline): approve or reject a prospect, set a price, mark a drafted touch as sent.
- The briefing's stop buttons for routines nobody reads.

## Reactions are feedback

React to any crew message: ❤️ or 👍 more like this · 👎 less · ✍ save it to notes · 👀 bring it back tomorrow ·
🤔 say it more plainly · 🙈 stop showing me this kind. The agent that wrote it reads your feedback in its next jobs.

## Commands

`/help` lists them all for your build. The core ones:

| Command | |
|---|---|
| `/today` | the day so far in one message |
| `/jobs` · `/cancel <n>` | open and recent jobs; stop one |
| `/status` | what each agent is doing |
| `/budget` · `/budget lift [all\|off]` | credit, today's allowance and how it is set; lift an agent's cap for today |
| `/credit <usd> <YYYY-MM-DD>` | a new budget or credit grant and its end |
| `/model` · `/model <agent> <haiku\|sonnet\|opus>` | models in use; switch one |
| `/projects` · `/routines` · `/routines stop <n>` | project cards; scheduled jobs |
| `/wish [agent] [model] <task>` · `/wishes` | a job for a quiet day, when credit is spare |
| `/library [words]` | newest reports, or a search |
| `/notes` | the Lead's standing notes |
| `/skills` · `/skills show <name>` · `/skills undo <name>` | the skills agents use |
| `/trace <agent>` | an agent's last steps, errors included |
| `/stop`, `/pause`, `/resume <agent\|all>` · `/reset <agent>` | control an agent; a fresh context |
| `/setup` · `/start` | create a topic for every agent; the setup checklist with a button per open step |
| `/mcp` | MCP servers and their tools |

Plugins add theirs: `/inbox`, `/google`, `/docs` (google), `/leads` (lead-pipeline).

## Routines

Ask the Lead: "every Monday at 8, summarise last week's commits". It saves a routine with a cron in your time zone;
each run is an ordinary job, sees the earlier runs in the library, and reports what changed. Results wait for the
morning briefing. `/routines` lists them with their next run.

## Budget

`pocketcrew.config.ts` sets an amount and an end date. Each day the crew may spend what is left divided by the days left,
but at most 1.5× the even pace (2.5× in the final week), so savings from quiet days cannot all land on one day. Each
agent gets its share of that, up to twice its share when the others are quiet. A reserve is never spent. When the day's
allowance is used, agents stop and say so; `/budget lift` frees an agent for the rest of the day. Unspent allowance runs
the wishlist.

## Skills

Skills are how-to notes agents read when a task matches: a report format, a checklist, a procedure. Send the Lead a
file or a link and ask it to save a skill; it is live at once and announced in General, with `/skills undo` to go back.
Skills never widen what an agent may do; its role file decides that.
