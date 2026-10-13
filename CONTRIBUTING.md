# Contributing

Thanks for helping. pocketcrew aims to stay small enough to read in an afternoon, so the bar for a change is that it
keeps it that way.

## Before you start

- For anything bigger than a fix, open an issue first and say what you want to change and why. A use-specific feature
  is usually a plugin, not a change to core (see [docs/plugins.md](docs/plugins.md)).
- Read [AGENTS.md](AGENTS.md): the map of the code and the rules for adding tools, agents, settings and tests.

## Making the change

```sh
npm ci
npm run check      # types, the safety checks and every test, with the plugins in pocketcrew.config.ts
POCKETCREW_PLUGINS=none npm test     # core alone; CI also runs each plugin on its own
```

- Match the code around you: plain TypeScript, small functions, comments that say why.
- A new tool declares honest risks (`private`, `untrusted`, `egress`); the build relies on them.
- No tool that sends email, deletes, or shares. Drafts and buttons instead.
- No personal names, addresses, account ids or hostnames in code, tests or docs; settings belong in
  `pocketcrew.config.ts`.
- Tests for what you add; a core test that needs a plugin says so with `needs()`.
- If agents should know about the change, update `skills/crew/SKILL.md` (or the plugin's `skill.md`) in the same
  commit, and `CHANGELOG.md` under Unreleased.

## Pull requests

One topic per pull request, a description of what changes for someone running pocketcrew, and green CI. By contributing
you agree your work is licensed under the Apache License 2.0.
