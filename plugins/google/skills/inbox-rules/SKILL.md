---
name: inbox-rules
description: What stays in the operator's inbox and what Mail archives, for new-mail triage and for sorting out the inbox; read it before archiving anything.
agents: mail
---

Goal: an inbox that holds only what still needs the operator. Archiving is not deleting: mail stays in All Mail,
searchable, and gets the fleet's archived label (<name>/archived, such as pocketcrew/archived), so the operator can review it and move it back.

Stays in the inbox
- needs-reply: a person asking the operator something, or waiting for an answer.
- domain-inquiry: anyone asking about buying, selling or pricing a domain.
- invoice: bills, receipts that need paying or filing, tax and accounting mail, until the operator says otherwise.
- Security alerts, sign-in warnings, password resets, and anything with a deadline in the next 14 days.
- Anything from a person (not a system) that you are unsure about. When in doubt, keep it.

Archive after labelling
- newsletter: newsletters, digests, marketing, promotions.
- notification: automated mail that needs no action: shipping updates, social media, app notifications, confirmations
  of something already done.
- fyi: once it is older than 7 days.

Sorting out the inbox (when the operator asks)
- Work in batches by search, oldest and safest first, for example: "category:promotions older_than:14d",
  "category:social older_than:14d", "category:updates older_than:30d", then known newsletter senders.
- Before a search-based archive, look at a sample (gmail_search with max 20) and confirm it matches the rule.
- Never archive by a search that could include a person's unanswered question, an invoice or a domain inquiry.
- Report per batch: the search, how many were archived, and two or three typical senders.
- End with what is left in the inbox, grouped by category, and how to undo: in Gmail, search
  label:<name>-archived, select, Move to Inbox; or ask Mail to restore.

Needs the operator (STATUS: needs-operator, which notifies them at once)
- A person waiting for the operator's answer, a domain inquiry or offer (Afternic, Sedo, a buyer), money due or a
  payment problem, a security alert the operator did not cause, anything with a deadline in the next 7 days.
- Not: receipts, codes the operator just asked for, newsletters, routine notices. Those go in the daily inbox line.

Reorganising the operator's labels (only with an approved plan in the brief)
- Start with gmail_labels. Create the new labels first (gmail_label_create), then rename (gmail_label_rename) where a
  label only changes its name, and merge by moving mail (gmail_relabel: search label:old, add new, remove old).
- Before each move, check a sample with gmail_search (max 20). Labels in Gmail searches use hyphens for spaces and
  slashes: label:travel-and-car.
- Keep the fleet's own labels (under <name>/) as they are; the triage depends on them.
- Labels emptied by a merge stay: list them at the end for the operator to delete in Gmail.
- Filters that send receipts or security mail to the trash: list them for the operator; the fleet cannot delete them.
  Propose label filters (gmail_filter_create) for the new system after the operator says yes.
- Report per step: what was created, renamed or moved, with counts and how to undo.

The operator changes these rules by telling the Lead; a rule from the operator wins over everything above.
