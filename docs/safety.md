# Safety

An agent that reads your mail, reads text a stranger wrote, and can send something out can be talked into sending your
mail to the stranger. pocketcrew is built so that this cannot be wired up by accident.

## The three risks

Every tool in the catalog (`src/tools.ts`, and each plugin's `tools`) and every MCP server (`src/mcp.ts`) declares its
risks:

- **private**: it reads your data (mail, calendar, documents, notes, prices, contacts);
- **untrusted**: it reads text someone else wrote (web pages, mail bodies, MCP answers);
- **egress**: it can carry something out (fetching a URL, a search query, dispatching work).

`fleetProblems()` (`src/safety.ts`) refuses any agent whose tools add up to all three, and runs as a test, so a fleet
that breaks the rule does not build. Split the work across agents instead: in the google plugin, Mail reads mail but
has no web; Research reads the web but no mail.

## Results between agents

- Agents that hold private data report to you, not to the Lead. The Lead gets three checked fields (status, a count, a
  suggested next agent: `parseStatus`), never free text, so a mail cannot instruct the Lead through a summary.
- Their reports never go into the research library that web agents search.
- A chained job (dispatch `inputs`) carries a full report to another agent without the Lead reading it.
  `inputProblem()` decides what may flow where: a private result only to private agents without a way out, and nothing
  that would give an agent private data, strangers' text and a way out together.
- The Lead reads no web or third-party content at all.

## What no agent can do

- **Send email or delete anything.** No such tool exists; Gmail work ends in drafts, archive only moves mail under a
  label so it can be undone, filters only label or skip the inbox, and MCP tools that send or delete stay off their
  allow-list.
- **Reach Google beyond `src/google/allow.ts`.** Every request is checked against it: no send, trash, spam, delete or
  sharing; calendar events never notify guests; documents are edited only when the crew created them or you allowed
  them with `/docs allow`. Agents never hold a token.
- **Widen its role with a skill.** Skills are how-to notes; what an agent may do is its role file and its tools.

## Secrets

The Anthropic key, the bot token, the webhook and sync secrets and the Google client are typed into
`npm run secrets` and stored in Cloudflare only (Worker secrets or a Secrets Store). They never go in the repo, a `.env`
file or an agent's transcript. Logs are on, traces are off, because traces would record Telegram API URLs that contain
the token.

## Who can talk to it

The Worker checks the webhook secret, the group's chat id and your Telegram user id on every update; anything else is
dropped. Published pages need a Cloudflare Access login. The dashboard (optional, `src/dashboard/`) binds only to
localhost or a tailnet address.

## Reporting a problem

See [SECURITY.md](../SECURITY.md).
