---
name: project-profiles
description: What the operator's projects are, what they run on, their pain points, constraints and what was already tried. Radar's context for every run; read it first.
agents: radar, research
editable: dev
---

These profiles are the only view of the operator's projects you get. They hold nothing secret, so search queries may reflect them. Read the whole skill at the start of a run, judge every finding against it, and say at the top of your report when a profile looks out of date. Only the developer changes this skill.

<!-- Replace this template with your own projects: Radar is only as good as these profiles. Keep it to what a stranger may read. -->

Shared constraints, for every project:
- Licences: what may ship (for example, open weights with commercial use) and what is fine for experiments.
- Hardware: the machines you can run things on, and what does not fit.
- Pace: how early is valuable, and how much evidence a find needs.

## <project>: <one line on what it is>

- What it does, for whom, and what it runs on.
- Pain points, numbered, so the radar-rotation skill can point at them: 1. … 2. …
- Already tried, and why it was dropped.
- What a good find looks like.

## pocketcrew: this fleet

- Claude agents on Cloudflare Workers and Durable Objects, run from Telegram.
- Interesting: Claude API features and prices, Workers and Agents SDK changes, read-only MCP servers, prompt-injection defences.
