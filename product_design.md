# Product Design — The Daily Edit (vintage-searcher)

*Living document. Started 2026-07-19. Companion to `taste_discussion.md` (taste-engine internals) and `CLAUDE.md` (system architecture). SPECS.md is the historical arbitrage-era spec and no longer describes the product.*

---

## 1. What this product is

A daily email that makes you feel like a veteran collector friend scans the entire vintage market every morning and sends you the three pieces worth knowing about — each with the story that makes it matter, what it's actually worth, and whether it fits you.

The three pillars, in order of differentiation:

1. **Story** — editorial narratives (brand era, construction details, cultural arc) in the register of a collector talking to someone in the hobby. This is the moat; nobody else does this per-listing.
2. **Taste** — the digest learns each subscriber from votes (and soon implicit signals) via contrastive scoring. "We know what you like better than you can describe it."
3. **Fit** — size matching so the pieces shown can actually be worn. Confirmed evidence excludes; weak evidence only demotes.

Languages: en + zh (Traditional). Distribution: email (Resend) + Threads (@vintage.stories, zh).

## 2. What we know (validated learnings, with data)

| Learning | Evidence | Date |
|---|---|---|
| **People want the email.** 53% open rate on a *daily* send — well above the ~35–45% newsletter norm. The channel is validated. | Resend dashboard | 2026-07-19 |
| **The gap is opens → clicks, not attention.** ~25 of 30 subscribers have never voted despite 80–250 items delivered each; half the list opens daily. | prod DB + Resend | 2026-07-19 |
| **The taste engine works when it gets signal.** Power-user Mason went 0/3 upvotes the day before contrastive scoring shipped → 6/6 upvotes in the two days after. (n=1, formal check 2026-07-23.) | prod DB replay + votes | 2026-07-18 |
| **Threads converts.** The size-feature announcement post produced 2 signups within a day on a ~30-person base. | signup timestamps vs post time | 2026-07-18 |
| **New signups use the size feature.** Both post-announcement signups set a top size. | prod DB | 2026-07-19 |
| **Silent failure modes are real.** A dead Threads token produced a phantom-success post; fixed with self-refreshing token + loud failure. Lesson: every outward action needs verification. | Threads API forensics | 2026-07-17 |

## 3. Who the subscribers are

~30 real people (33 rows minus obvious typos), joined Feb–Jul 2026 at a steady trickle, now ~4–12/month. Mix of en/zh. Archetype selections skew: americana, military, european-workwear, ivy — classic menswear vintage. One power user (Mason: 70 votes) proves the engaged ceiling; a handful of light voters; the rest read silently.

## 4. The direction question (OPEN — decide deliberately)

Three candidate directions, not mutually exclusive but demanding different investment:

- **A. Taste engine as the product.** Personal curation as the identity. Requires the instrumentation layer (below) so the engine feeds on implicit signal from all subscribers, not just voters. Mason is the proof-of-concept.
- **B. Threads-first media brand.** The stories are the asset; the digest is the conversion funnel. Argues for automating a daily Threads post from the pipeline and treating follower growth as the top metric. Evidence: posts convert.
- **C. Monetize the click.** eBay Partner Network affiliate links on every button — revenue AND click/purchase tracking in one move (EPN reports both). Cheapest path to the measurement layer of A.

Current stance (2026-07-19): direction deliberately parked. Instrumentation (below) is step zero for **all three** — you can't steer blind — and C's EPN links may be the cheapest way to get part of it.

## 5. Metrics that matter

Funnel: **delivered → opened → clicked through to eBay → voted → (bought)**

- Channel health: open rate (baseline 53%, watch for decay)
- Product engagement (north-star candidate): **eBay click-through rate per digest** — a click is stronger intent than a vote and demands nothing extra from the reader
- Taste quality: upvote share among votes cast; Mason experiment as the running case study
- Growth: signups per Threads post; subscriber count (~30)
- Currently unmeasured: clicks (no tracking), unsubscribes (no mechanism!), purchases

## 6. Roadmap candidates (near-term, roughly ordered)

1. **Instrumentation package** — the agreed step zero:
   - ✅ eBay-button click tracking (2026-07-19): button routes through signed `GET /go` → `EngagementEvent` row → 302 to listing. Per-user, per-story purchase-intent signal in our own DB; the redirect is also where future EPN affiliate links slot in.
   - Purge/handle bounce addresses (3 known bad)
   - Unsubscribe link + List-Unsubscribe header (deliverability + honest churn signal)
   - `/resend/webhook` endpoint storing open/bounce/complaint events in `EngagementEvent` (Resend signs events; tags on send make them self-identifying)
   - Feed clicks into taste scoring as implicit votes (a clicked item ≈ weak upvote) — deliberately after a week of real click data
2. **Mason verdict (2026-07-23, scheduled)** — decide whether contrastive scoring stands or needs the fallbacks in taste_discussion.md
3. **Threads cadence** — automate a daily/near-daily post from the scan pipeline (title/intro generated, human-approvable); measure signups per post
4. **eBay Partner Network** — apply, swap listing URLs for affiliate links (pairs naturally with #1's click tracking)
5. Ops visibility — revive the existing Discord webhook as a pipeline ops channel (scan summaries, failures)

## 7. Open questions

- What's the actual click-through rate? (Answerable within a week of instrumentation.)
- Why do zh users vote less than en users, or do they? (Check once clicks are measured.)
- Is daily the right cadence, or does a 53%-open audience want *more* (e.g., a weekend deep-dive edition)?
- At what subscriber count does the shared-evaluation cache stop absorbing Gemini costs? (Currently costs scale with unique listings, not users — good.)
- When (if ever) to expand beyond menswear — women's sizing was deliberately scoped out.

## 8. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-13 | Size matching ships: confirmed evidence excludes, weak evidence demotes (×0.85) | "Story is everything" — never delete on uncertainty |
| 2026-07-16 | Contrastive taste score replaces like/dislike dual-call; dislike multiplier deleted; 0.4 quality floor | Swimsuit incident; full forensics in taste_discussion.md |
| 2026-07-17 | Threads token self-refreshes from DB; outward actions verified, never trusted | Silent-failure postmortem |
| 2026-07-19 | Email channel validated (53% open); direction parked pending instrumentation | This document |
