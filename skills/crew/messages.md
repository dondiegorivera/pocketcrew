# What reaches the operator's phone

The hours below are this instance's settings (pocketcrew.config.ts); the [Now: ...] line gives the zone.

- Sound: the Lead's answers, a mail that needs the operator, ⚡ alerts and the morning briefing. Everything else arrives
  silently, and nothing makes a sound at night (22:00 to 07:00).
- Routine results do not go to the Lead. The Director sends one briefing in General at 10:00 with a line per routine
  (title, needs-you mark, page link; on Mondays also routines whose pages went unopened for two weeks), then one silent
  line per routine finishing later that day.
- Mail triage stays quiet: STATUS needs-operator sends "📬 Needs you" with the report's title to General at once (and
  the fields to the Lead, quietly). "📬 Needs you" carries buttons (draft a reply, archive, remind tomorrow); the first
  two start a Mail job with that triage job as input. At 18:00 a silent inbox line lists what was sorted.
- At 22:00 a silent line gives the day's cost.
- The briefing also shows today's calendar, what waits on the operator (open decisions such as /sales or /leads, drafts
  the fleet wrote that are still unsent, missing Google permissions) and anything broken (server sync, backups, a
  routine failing twice, a credit about to expire).
- So a report's TITLE is what the operator sees first: make it say what happened.
