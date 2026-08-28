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

## 4. Direction — PARKED (2026-08-10)

> **Status: parked.** The deep-personalization exploration below (visual signatures, hard themes, the cosplay/character detour) did not converge on a concrete next build — the Tinder-swipe prototype (2026-08-08/09) was built to test the costume/identity direction and **didn't feel great in practice**. No better concrete idea yet. Default activity until then: **grow the existing email product** (subscribers, deliverability, Threads cadence) rather than new personalization R&D. Revisit this section when a sharper idea shows up — the thinking below is preserved, not discarded.

### 4a. Original CUJ-driven direction (2026-07-20)

**The CUJ (Adrian, 2026-07-20):** subscribers open the email to see clothes → they look at the **pictures** → if an image catches them, they read the story → maybe click the eBay button. *Images are the decision moment.* Stories deepen interest; they don't create it.

Implications the direction now rests on:

1. **Personalization is the gold, and it must become visual.** The taste engine currently compares story prose, but votes/clicks are reactions to images — signal and representation are mismatched. Plan: Phase 1 emits a cached **visual signature** per listing (palette → texture → silhouette → patina → standout detail, one dense line) + picks the **hero shot** from the 12 photos; contrastive scoring compares signatures. Zero extra API calls. Later upgrade path: real image embeddings.
2. **Daily themes — hard, fetch-level, orthogonal-axis.** Theme defines the day's candidate universe (the eBay queries themselves); personalization ranks within it. Themes live on axes orthogonal to archetypes (color, era, construction detail, provenance, price band) so theme and taste compose rather than collide. Soft/tiebreaker theming rejected — defeats the purpose. Side benefit: one shared query set per day is *cheaper* than per-archetype fan-out. Pipeline restructuring required; design open (theme selection, cadence).
3. **Themes are the probe, clicks are the sensor.** Not everyone is Mason — most users will never vote, but they'll click. Themes deliberately push variety past the engine's bubble (structured exploration); clicks capture reactions effortlessly; `EngagementEvent` stores the probe-response pairs. A click on an off-taste theme item carries the most learning (surprise = signal). Sequencing: accumulate click data (running now, logging-only — scoring untouched) → build theme mechanism → then feed clicks into taste scoring as weak likes.
4. **English Threads community: parked.** zh Threads converts and stays; the English market is bigger but contested — revisit after the personalization moat is real.

Earlier A/B/C framing (taste-engine / Threads-media / monetize-click) resolves as: **A is the direction**, B stays a channel, C (EPN) slots into `/go` whenever monetization matters.

### 4b. "Are we just eBay + personalization?" reckoning (2026-07-31)

Forced test: eBay itself could copy "personalization on top of our inventory" — it's a feature, not a moat, and eBay has far more purchase-signal than we'll ever have. Counter: eBay's personalization has a **structural ceiling**, not just an effort gap — one engine serving every category can't go deep on any single vertical the way a narrow, opinionated product can. Defined three levels of fashion personalization:

- **Level 1** (eBay/Amazon): collaborative filtering — "people who clicked X also clicked Y." No understanding of *why*.
- **Level 2** (roughly where we are): vibe/aesthetic similarity via story-prose comparison (Stitch Fix territory) — better, but an opaque black-box judgment.
- **Level 3** (nobody's built this for fashion): interpretable, faceted taste — structured collector facets (era, construction/authenticity markers, material, silhouette, narrative-arc type) instead of prose; **learned per-user facet weights** so recommendations are explainable ("picked because you respond to union-label pieces with visible repair"); visual taste scored at the construction-detail level, not just color/silhouette; **fit fused with taste** — learned per-brand/era sizing drift specific to the user, not static tolerances; a **legible, evolving taste profile shown back to the user** as its own product surface; themes used as *active* taste-mapping probes, not just discovery.

Foundational piece identified: structured facets + learned per-user weights (bullet 1+2) — everything else sits on top of that. Not built.

### 4c. Preference-signal research pass (2026-08-01)

Surveyed how other products elicit preference, since votes alone weren't yielding enough signal (~25 of 30 subscribers never voted):

- **Stitch Fix Style Shuffle** — a standalone swipe game (thumbs on outfit photos), separate from any single delivery; 75% of users play it, feeding real-time taste models. For us: a page built from the 3,600+ already-evaluated listings could solve new-subscriber cold start in minutes.
- **Cold-start academic literature** — pairwise ("which of these two?") beats single-item rating for informativeness; active learning picks the most informative next question. Maps directly onto the contrastive taste scorer, which already wants A-vs-B pairs.
- **Newsletter one-click polls** — lift both engagement and deliverability (beehiiv/Litmus/Inbox Collective). Cheapest form for us: a "which won today?" pick among the 3 delivered items.
- **TikTok** — zero onboarding, pure behavioral inference; a like can be performative, real behavior doesn't lie. Validates leaning on clicks over votes; email's ceiling on implicit signal is lower than video (no dwell/watch time).
- **Grailed/Depop "grail list" pattern** — collectors already think in standing hunts. A "reply with what you're hunting" mechanic → parsed into direct eBay queries; email replies are also the single strongest deliverability signal there is.

Ranked recommendation (not built): (1) this-or-that pairwise block in the digest, (2) grail-list via reply, (3) Style Shuffle-style cold-start page, (4) "best of today" poll.

### 4d. The costume/cosplay thesis (2026-08-02 to 2026-08-08) — tested, parked

Core reframe (Adrian): clothing's real product is identity performance — "we're all cosplaying to be someone." Vintage is uniquely suited to this because every piece already carries a pre-built character (a union label is a workman, a Baracuta G9 is a 1960s London kid) — the story engine has effectively been doing costume-department research since day one, just aimed at the garment instead of the wearer. Reframed archetypes as **roles**, not style categories (Ivy = the young professor, Biker = the outlaw).

Explored and set aside as too gamey / disconnected from real recommendations: swiping on full "characters" (persona + scene) rather than single garments; a progressive "character sheet" reveal instead of a taste-profile paragraph; swipe contradictions spawning a second persona rather than the user choosing "multiple selves" mode upfront.

Refined via the retail sales-associate mechanism (Adrian, 2026-08-08): the actual dopamine trigger is **successfully imagining a better version of yourself, with help** — not gamification, not aesthetics alone. Decomposed what a good associate does: completes the picture (full outfit, not one item), narrates a scene not a spec ("Friday night, you walk in wearing this" vs. "raw denim, selvedge"), implies a social payoff (an imagined audience reacting), reads and tailors the pitch to be plausible for *this* person, grants permission/confidence (pre-empts self-doubt), anchors it visually (the mirror). Our edge vs. a live associate: no real-time responsiveness, but weeks of longitudinal knowledge no in-store associate has.

Cheap, mostly-already-built path identified but not shipped: the existing `styleGuide` field already attempts the associate's job but in third-person instructional voice ("this pairs well with…") rather than second-person scene/permission voice ("you, walking in wearing this…") — rewriting the voice, paired with a full-outfit visual as the "mirror," might unlock much of the effect without new infrastructure. Left open: does the imagined "you" need to feel earned/specific (tied to known archetype/size/history) to land, or does strong generic second-person copy get most of the way there cheaply? **Untested.**

**Outcome:** a Tinder-swipe prototype was built to test the identity/costume direction directly. It didn't feel great. Parked pending a better concrete idea — the `styleGuide`-voice rewrite and the pairwise/grail-list mechanics from 4c remain candidate next experiments if/when this reopens.

## 5. Metrics that matter

Funnel: **delivered → opened → clicked through to eBay → voted → (bought)**

- Channel health: open rate (baseline 53%, watch for decay)
- Product engagement (north-star candidate): **eBay click-through rate per digest** — a click is stronger intent than a vote and demands nothing extra from the reader
- Taste quality: upvote share among votes cast; Mason experiment as the running case study
- Growth: signups per Threads post; subscriber count (~30)
- Currently unmeasured: clicks (no tracking), unsubscribes (no mechanism!), purchases

## 6. Roadmap candidates (near-term, roughly ordered)

**Current focus (2026-08-10): growing the existing email product** — subscriber growth, deliverability, Threads cadence. Personalization/instrumentation items below are on hold, not deleted, until the direction in §4 unparks.

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
| 2026-08-05 | Mason Lee unsubscribed (email cleared, history preserved) | User request; taste-scoring vote history kept for record |
| 2026-08-10 | Deep-personalization direction (visual signatures, hard themes, cosplay/costume) parked; focus shifts to email growth | Tinder-swipe prototype tested the costume direction and didn't feel great; no better concrete idea yet |
| 2026-08-10 | Price block moved above the eBay CTA in email; hero images background-removed via `gemini-3.1-flash-image` | Messy/inconsistent listing-photo backgrounds looked unprofessional; price-before-buy-decision is a small conversion improvement |
| 2026-08-10 | Background color: gray (`#d9d5cc`) initially shipped after a side-by-side test, then overridden to pure white same day after reviewing a live production batch (8 evaluations) | Gray's advantage (matches brand cream, avoids pasted-cutout look) didn't hold up as well in practice as expected; the 8 gray evaluations from the interim window are permanent (never regenerated) |
| 2026-08-13 | Email made more compact: price + vote folded into one quiet single-line row (no card), separate feedback card removed, styleGuide trimmed to one sentence (render-time + generation prompt) | Isolation/Von Restorff research: price styled like the eBay CTA competed with it instead of reinforcing it — CTA is now the one bold element per item. Vote moves earlier (closer to gut reaction); mainStory left untouched — that's the actual moat |
| 2026-08-14 | Price/margin numbers sized up (17px → 22px, still no box); red flags removed from the email entirely (still stored on Evaluation, unused by the UI) | Bigger price reads better while keeping the CTA as the only bold element; users didn't care about red flags in practice — data stays available if a future use emerges (e.g. an authenticity gate) |
| 2026-08-15 | Search scope fixed: each archetype's keyword pool expanded (~50 new specific terms researched per archetype — real collector terminology, not generic phrases) with a small daily-rotating active window (3/archetype), computed fresh per scan instead of the old signup-time snapshot | Root cause of "getting similar stuff" diagnosed: fixed 4–5 generic keywords ran unchanged since signup, thinly split across up to 15 simultaneous queries. Deliberately went specific-and-long over generic-and-short (precision over recall) — narrow terms pre-select for sellers who know what they have, and rotation solves staleness without sacrificing per-query depth (~2.2 listings/query now vs ~1.3 before, ~0.65 if the pool had been expanded without rotation). Considered and parked: forced-choice "pick your favorite" vote (felt too demanding); LLM-driven keyword discovery from vote history (option C) — only one archetype config has enough votes (99) to try it today, banked for later |
| 2026-08-16 | Round-2 keyword coverage: 10 parallel research agents (one per archetype) audited the 2026-08-15 pools against real collector culture and found systematic gaps — garment-type tunnel vision (Military 100% jackets, Cowboy 100% shirts, European Workwear 100% outerwear) and missing named heritage brands (Biker had no Vanson/Buco/Langlitz/Harley-Davidson; Ivy had zero named makers). ~168 new terms added across all 10 archetypes (pools now 15–34 terms each); footwear explicitly scoped out despite 6/10 agents flagging it | The 2026-08-15 pass was a single research pass by one model in one sitting — parallel independent agents per archetype surfaced blind spots a single pass missed, confirming the "specific and long, not generic and short" strategy was right but under-executed on the first attempt. Rotation window (3/archetype) intentionally left unchanged — bigger pools just mean a longer full-coverage cycle, which is the point |
| 2026-08-19 | Growth becomes the explicit priority (goal: first 100 users), superseding further email/personalization polish; second Threads account (@wolf.2833331, English) launched alongside the existing @bear.7306501 (Chinese) | Email and deep-personalization considered "enough for now" by the user; distribution/audience-building was the visible gap. `/threads?account=en\|zh` generalizes what was a single hardcoded account |
| 2026-08-22 | AI virtual try-on ships: one Gemini-generated render per user per day, on their own uploaded photo, surfaced as a front-loaded "pick one to try on" picker in the email | Reframed as a growth lever, not a resumption of the 2026-08-10 parked deep-personalization direction — the pick doubles as a richer preference signal than a vote, and the rendered image is inherently more shareable content for the Threads accounts than a raw listing photo. Quality validated with 5 real listings against a real photo before building (Gemini 3.1 Flash Image — the same model Google's own shopping try-on runs on — handled drape/fit well; one fixable issue found: layered garments like overalls dropped the base layer underneath). Rate-limited to 1/day and given its own un-throttled, fail-fast generation path — deliberately not sharing the batch scan's 15s Gemini throttle, since a real user is waiting on the page |
| 2026-08-22 | Try-on picker redesigned same-day: thumbnails → a plain numbered text list ("Today's Pick — you get one shot today, choose wisely"), no images at the top of the email | Thumbnails risked picture-then-bounce behavior — click try-on, never scroll to the stories, which are the actual product ("story is everything"). Text-only keeps the quick-decision hook without competing with the story content; copy leans into the once-a-day mechanic as a deliberate game framing (Wordle-style "one shot" convention) rather than downplaying the limit |
| 2026-08-23 | Removed the photo-nudge banner and standalone `/photo/upload` page (both shipped 2026-08-22, one day earlier); picker now always shows, and `/tryon` handles photo upload inline with a self-reload into generation | Gating the picker behind `hasPhoto` created a staleness bug: that flag was only read once, at scan time, so uploading mid-day meant waiting until tomorrow's email to actually use it. An always-visible picker fixes discoverability better than a banner anyway, and merging upload into `/tryon` itself (same URL, reload after upload) is fewer moving parts than the two-page version it replaced, not more |
| 2026-08-25 | Try-on rate limit changed from "one per UTC calendar day" to "one per digest batch" — every digest send gets a `batchId` (`StoryDelivery.batchId`), and unused batches never expire, so skipping a few days' emails and then trying several picks in one sitting is allowed by design | The day-based limit had a real dead zone: miss a day's email entirely and that day's try was just gone; use today's try-on early and you're locked out even though nothing new had arrived yet. Explicitly confirmed with the user that unused quota should stack with no cap, rather than capping it — a user who's behind on emails should be able to catch up in one sitting, not be further penalized for it |
| 2026-08-28 | Try-on picker redesigned again: text-link rows → real gold CTA buttons, one per item, copy cut down further; "today" wording fixed to reflect the per-batch (not per-day) quota | Only ~24% of the 54 recipients since launch had ever clicked into try-on — a subtle text-link list wasn't reading as clickable. Buttons plus shorter copy directly address that; the leftover "one shot today" line was also just stale after the 2026-08-25 quota change and needed fixing regardless |
