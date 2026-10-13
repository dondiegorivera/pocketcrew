---
name: prep-tax-advisor
description: Recipe for the tax advisor's pack: learn from the operator's earlier cover letters in Drive what they usually send, gather this period's documents from Gmail, and prepare the Sheet, the summary Doc and the cover email as a draft.
agents: clerk
---

The operator sends their tax advisor (Steuerberater) a pack of documents each period with a cover letter. The earlier
cover letters in the operator's Drive are the checklist: they say what the operator usually sends.

1. Learn the checklist
- drive_search for the earlier cover letters, for example: Steuerberater, Steuerberaterin, Anschreiben, Unterlagen,
  Buchhaltung, Einkommensteuer, Umsatzsteuer, tax advisor (try several; kind doc, word or pdf).
- drive_read the two or three newest. Note: the advisor's name and address or email, the period they covered, how the
  letter is laid out, and every kind of document they listed (for example: invoices issued, received invoices, bank
  statements, receipts, insurance, donations, rent, car, travel, phone and internet, subscriptions).
- If no cover letter is found, stop and ask the operator for one link instead of guessing.

2. Find this period's documents in Gmail
- The period comes from the brief; if it does not, ask. Use after:/before: dates in every search.
- One or more gmail_search queries per checklist item, in German and English, by sender and by words (Rechnung,
  Invoice, Quittung, Receipt, Beleg, Kontoauszug, Beitrag, Spende, Versicherung), plus has:attachment.
- Open invoices and receipts with gmail_attachment when the mail text lacks the amount.

3. Label what you use
- gmail_label every message you use with tax-<year> (or tax-<year>-q<n>) and one kind label (invoice, receipt,
  statement). Labels only: the mail stays where it is.

4. The Sheet (sheets_create): one row per document
- Columns: date, sender, what it is, checklist item, amount, currency, VAT if shown, Gmail thread id.
- A summary tab: count and total per checklist item and currency (formulas, such as =SUMIF).

5. The summary Doc (docs_create)
- Totals per checklist item; what the earlier letters listed that this period lacks; anything unusual (a new
  sender, an amount far from earlier periods). No tax judgement: list questions for the advisor instead.

6. The cover email (gmail_draft, never sent)
- To the advisor's address from the earlier letters or their earlier mail; in the language and tone of the earlier
  letters; the period, the list of what is enclosed, the links to the Sheet and the Doc, and the missing items.
- Attachments cannot be added to a draft by the fleet: say in the report which documents the operator should attach,
  or that the advisor finds them under the label.

7. Report
- Links to the Sheet, Doc and draft; the label and its count; per checklist item found or missing; what you were
  unsure about.
