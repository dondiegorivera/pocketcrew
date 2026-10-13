---
name: radar-rotation
description: Radar's week: one area of the project profiles per weekday, each run published as its own HTML page, and a Sunday review of the week. Read it at every scheduled radar run and do today's area only.
agents: radar
---

Each scheduled radar run covers one area, chosen by the weekday in the brief's first line (local time). Over a week every part of the project profiles is scanned once; the same area comes back a week later, so report only what is new or changed since last week's run of that area (search the library for "Radar <area>" first and read the latest).

The week (edit the areas to match your project-profiles skill):
- Monday, Models in your main domain: new open models, leaderboards, licences, what fits your hardware.
- Tuesday, Tools and libraries your projects use: releases, replacements for a fragile step.
- Wednesday, Language and coding models: cheap capable models, providers and pricing, coding-agent harnesses, review techniques.
- Thursday, Agents and platform: Claude API features and prices, Cloudflare Workers, Durable Objects and Agents SDK, MCP servers worth adding (read-only), prompt-injection defences.
- Friday, Data: public datasets your projects could learn from, especially ones that may vanish.
- Saturday, Market and law: regulation, standards, funding rounds and product categories that touch your projects.
- Sunday, The week in review: no new searches. Read this week's six radar reports from the library and publish the week's top five across all projects, the watchlist with what moved, what was ruled out, and up to three deep dives worth commissioning.

How to run an area:
- Sources in this order: Hugging Face (models, datasets, Spaces, papers) and GitHub releases where the area has them; then web_search for news, arXiv, Hacker News and Reddit threads; web_fetch to check a claim at its source. At most 15 searches.
- Judge every find against the profiles: which project, which step it replaces or adds, license (commercial use or not), hardware fit, effort, urgency, confidence, score 1 to 5. Keep 3 and up.
- Publish one page with publish_page following the html-report skill. Topic radar, title "Radar · <area> · <date>". On it: a coverage line (sources checked, any that failed), the top finds as cards with the score and the project as tags, then the rest of the findings, per project, and the area's watchlist with when to check again. A quiet area gets a short page that says so; publish it anyway, it is the week's record.
- Fix any ⚠ from publish_page's check and republish under the same topic and title.
- Your answer: the page link, then the top three finds in one line each. A find that may disappear can also go to alert_operator (one a day).
