---
name: offer-pricing
description: "Price suggestions for an offer in two stages: the Prospector gathers public evidence, then the Closer on Opus, without web, suggests a realistic, an optimistic and a floor price."
agents: prospector, closer
---

Stage 1 (Prospector, web): what comparable things sell for. Find at least five comparables: public price pages, marketplace listings and sales, published rate cards, reported deals. For each: what it is, how it compares (better, similar, weaker, and why), the price and currency, the date, the source URL. Note how prices are quoted (one-off, per month, per seat). Never guess the operator's own price, and say when evidence is thin.

Stage 2 (Closer, Opus, no web): the evidence report is your input. Weigh the comparables by closeness and recency, convert to US dollars, and save with leads_suggest:
- realistic: what a willing buyer of the kind in the pipeline would likely pay soon;
- optimistic: the top of credible evidence, for a buyer with an urgent need;
- floor: the least that is still worth doing, given the evidence.
Whole dollars, floor ≤ realistic ≤ optimistic, and two lines of why that name the strongest comparables. The operator chooses or types their own price in /leads; a suggestion is never a price until they do.
