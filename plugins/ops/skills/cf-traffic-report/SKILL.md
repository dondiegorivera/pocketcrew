---
name: cf-traffic-report
description: "Daily Cloudflare traffic report: all sites, human visits, spikes, top 20 performers with graphs, as a phone-first HTML page."
updated: 1791701218222
---

Purpose: a daily overview of the operator's domain portfolio (100+ Cloudflare zones plus Workers) that leads with SUDDEN CHANGES and splits traffic into humans vs agents/bots. Some domains host agent-facing services (APIs, MCP endpoints, sites crawled heavily by AI). It is read on a phone in a minute.

1. Data: discover before querying
- Use the Cloudflare GraphQL Analytics API through cf_graphql. Run sites_capabilities once per run: it lists which datasets and fields this account and token allow (as of 2026-10-11: zone request detail with paths, countries, browsers, full user agent and verifiedBotCategory, but no referrers, bot score or Bot Management; Workers via workersInvocationsAdaptive; Web Analytics via rumPageloadEventsAdaptiveGroups with count, sum { visits } and dimensions requestHost, requestPath, refererHost, countryName, deviceType, userAgentBrowser, on the hosts sites_capabilities lists). Never assume a field exists.
- Humans: on hosts with Web Analytics, its visits are the human number (it counts browsers that ran the page, so bots mostly drop out); label it "Web Analytics visits". Its refererHost is the best clue to a spike's cause. Hosts without it: say so, and use the approximate split below.
- The split from zone data: verifiedBotCategory names the known bots (search engines, AI crawlers and the like); the rest is split by userAgent into declared automation (bot, crawler, spider, curl, python, headless and so on) and likely humans. Label it "approximate: verified bots + user agent".
- Preferred sources, best first:
  a) Bot split: httpRequestsAdaptiveGroups (or the equivalent dataset available), grouped by any bot-related dimension the account exposes (bot score or bot class, verified bot category, AI crawler / AI bot classification, user agent family).
  b) Human visits: Web Analytics (RUM) visits, if enabled for the zone; otherwise "visits" or page views with bot traffic filtered out.
  c) Workers: workersInvocationsAdaptive (requests, errors) for Workers and Workers sites.
  d) Fallback: page views or requests by zone (httpRequests1dGroups or similar).
- Label every number with the metric it uses. If no bot dimension is available on this plan, say so once at the top. Then show "requests vs page views" and user-agent based hints as a rough split, labeled "approximate".
- Use the last complete UTC days. Mark partial days.
- Never invent numbers. Data or access issues go in one line at the top.

2. Sudden-change detection (the core)
- Baseline per zone: the median of the previous 14 complete days (or 7 if less history is available).
- Flag a sudden change when yesterday is at least 2x the baseline (spike) or at most 0.5x (drop), AND the zone has meaningful volume (at least 50 daily requests or page views at baseline, or at least 200 yesterday for a spike). This keeps tiny sites from creating noise.
- Track separately: a human spike, an agent/bot spike, a share shift (the agent share changing by 20 points or more), new traffic on a previously silent zone (from about 0 to at least 100), and error surges (5xx rate above 5% with real volume).
- For each change: the zone, the type, yesterday vs baseline (x-factor), the metric, and the likely cause if the data has top paths, referrers, countries, user agents or verified bot names. Otherwise write "cause unknown".

3. Page layout (top to bottom)
1. Portfolio pulse: 2-3 lines with the total and trend vs the prior 7 days, the human vs agent share for the portfolio, and how many zones changed suddenly.
2. Sudden changes: cards, the biggest first, each with a mini sparkline of the last 14 days. If there are none, say "No sudden changes" in one line.
3. Humans vs agents: a portfolio split bar, plus the top zones by agent share.
4. Agent-facing domains: zones where agent/bot traffic is the majority or growing, and Workers endpoints, with requests, error rate and trend.
5. Top 20 by human (or best available) traffic over the last 7 days: EVERY row has an inline SVG sparkline (7-14 points, simple path), the 7-day total, a trend arrow and the agent share.
6. Quiet zones: one line with the count of zones with no meaningful traffic. No rows.
7. Data and access notes: one line each, only if any.
- Compare with the previous run and mark items that are new since yesterday.

4. Style
- Match the html-report skill if it's visible (read it with read_skill). Otherwise use the rules below.
- One self-contained HTML file: inline CSS and SVG, no external assets. Keep it light so publishing succeeds (simple paths, no huge tables).
- Phone-first: body text about 18px, small text at least 15px, chart labels at least 14px, line-height about 1.55.
- A calm palette with 2 semantic colors, one for spike or up and one for drop or down. Use separate colors for humans and agents in every chart. Bold only the key numbers.
- CSS-only dark/light toggle: a hidden checkbox plus a label styled as a sun/moon button (44px or more, fixed in a top corner). Switch the theme CSS variables with :has() or sibling selectors, and default to the system theme. Charts use CSS variables so they switch too. Optional JS only to remember the choice, with localStorage in try/catch.
- No footnotes and no sources section.

5. Publish
- Use publish_page under the topic "cf-traffic" with the page name "daily traffic". If it fails, retry once with a lighter page (fewer chart points). If it still fails, give the exact error.

6. Job result (it goes to Telegram)
- Plain text, no Markdown, never empty. Give the pulse in 1-2 lines, the sudden changes one line each (or "none"), the human vs agent share, the page link (or the exact error), and the metrics used plus any plan limits found.

7. Checklist before publishing
- The sudden changes lead the page, and the volume threshold has been applied.
- Every number carries its metric. Approximate splits are labeled.
- All 20 top rows have charts that are readable at 360px width.
- Human and agent colors are consistent across all charts.
- The dark/light toggle works without JS and switches the charts.
