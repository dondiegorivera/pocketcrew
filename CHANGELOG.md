# Changelog

Each release is a tag `vX.Y.Z` with a section here; the release workflow publishes that section as the GitHub release.
Versions follow semver for what an owner touches: pocketcrew.config.ts, the plugin manifest (src/plugin.ts), the
commands, and npm run setup.

## Unreleased

## 0.1.0

The first public release.

- Core: the Lead on Telegram, jobs on parallel workers, routines in your time zone, the wishlist, projects, skills
  (saved in chat or from a URL), published pages, the morning briefing, quiet hours, buttons and reactions.
- Budget pacing over a credit or monthly budget with an end date, per-agent shares, a reserve that is never spent.
- Safety: no agent holds private data, strangers' text and a way out together (checked at build time); no tool sends
  mail or deletes; private results reach the Lead only as checked fixed fields.
- Plugins: google (Mail, Calendar, Clerk), web (Research, Radar), notes (Notes, Obsidian), ops (Ops: git and site
  traffic).
- npm run setup, pocketcrew.config.ts, CI with a plugin matrix.
