# Security

pocketcrew gives language models access to someone's mail, calendar, documents and money, so we take reports seriously.

## Reporting

Please do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability). Include what an attacker needs (a message in the group, a crafted web page or
mail, access to the home server), what they get, and steps to reproduce. We aim to answer within a week.

## What counts

Especially welcome:

- a way for text from outside (a web page, a mail, an MCP answer, a file) to make an agent act against its role:
  send data out, reach the Lead with free text from a private agent, or get around `src/google/allow.ts`;
- a fleet that `fleetProblems()` or `inputProblem()` should refuse but does not;
- a way to read published pages without Cloudflare Access, or to talk to the bot from outside the configured chat;
- secrets reaching logs, transcripts, the repo or the archives.

Out of scope: what an operator chooses to allow (their own plugins, MCP servers, or tools with mislabelled risks), and
the behaviour of Telegram, Cloudflare, Google or Anthropic themselves.

## Supported versions

The latest release.
