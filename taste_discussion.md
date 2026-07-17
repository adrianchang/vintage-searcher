# Taste Scoring — Design Discussion & Decisions

*2026-07-16. Written up from the working session that debugged the Mason swimsuit incident and redesigned personalization. This is core product thinking: the app's job is to calculate people's taste. Read this before touching `computeTasteScores`, `combinedScore`, or the ranking loop in `scan.ts`.*

---

## The product thesis

Every subscriber gets 3 items a morning. The entire value of the product is that those 3 items feel *chosen for them* — story-worthy pieces that match a taste the user themselves may not be able to articulate. Votes (👍/👎) are our only direct taste signal. The scoring pipeline is therefore not a ranking convenience; it IS the product.

## The incident that drove this redesign

**Symptom:** mason.lee94@gmail.com (archetypes: european-workwear + british-mod + military, 64 votes) received a *women's one-piece swimsuit* (Berlook, 2020s) in his 2026-07-15 digest — while a 1940s US Navy N-1 Deck Jacket sat unsent in the same candidate pool.

**Forensics (all numbers from prod DB + live replay):**

- The pool that day had 15 candidates. Base scores: N-1 Deck Jacket **0.88**, Levi's Trucker 0.72, OshKosh chore 0.72 … swimsuit dead last at **0.252** (story 0.45, price 0, ×0.7 era penalty). The content pipeline judged everything correctly.
- The like-scorer also judged correctly: N-1 got personal 0.95, swimsuit 0.10.
- The dislike-scorer destroyed it. Mason's downvote history is ~20 *jackets* (the generic ones: McGregor, Cherokee, "Modern Generic Leather Moto", an AI-generated fake). Asked "how similar is each candidate to his disliked items?", Gemini honestly answered ~**0.85–0.95 for every jacket** — category similarity — and **0.20 for the swimsuit**.
- The formula applied that as a multiplier: `score × (1 − dislikeSim)`. The N-1 kept 5% of its score (final 0.042); the swimsuit kept 80% (final 0.098). **The worst item in the pool ranked #1.**

**Root cause, stated generally:** any engaged user's likes and dislikes converge on the same category — that's what having taste in a niche *is*. Category-level dislike similarity therefore saturates high for every relevant candidate (zero discrimination in-genre) while handing a structural advantage to out-of-distribution items, which evade the penalty precisely because the user has never rated anything like them. The dislike channel contributed no signal and one landmine.

**Secondary cause — arithmetic asymmetry:** likes were additive with weight 0.4 (max influence ≈ +0.38); dislikes were multiplicative (max influence ≈ −95% of everything). One channel had veto power over the combined opinion of the like-scorer, story score, and price score. The like signal was *right* that day and got overruled.

## What we shipped (three changes)

### 1. Contrastive taste score — one call, both lists
`computeTasteScores(candidates, liked, disliked, styleContext)` replaces `computePersonalScores` + `computeDislikeScores`. One Gemini call receives up to 20 liked AND 20 disliked items together and scores each candidate 0–1 by **which side of the voting history it resembles**. The prompt explicitly says:

> Their likes and dislikes may be the SAME garment category — the signal is what DIFFERS between the two lists (era, authenticity, brand caliber, construction quality), not the category itself.

Rubric: 0.9–1.0 matches the liked pattern / 0.7–0.9 closer to likes / 0.4–0.7 mixed / 0.0–0.4 closer to dislikes **or unlike anything they've liked** (out-of-distribution scores LOW, not neutral — that's what closed the swimsuit loophole).

Cold start (no votes) falls back to archetype-profile-only scoring, as before. Cost: one fewer API call per user per scan; candidates serialized once instead of twice.

### 2. Dislike multiplier deleted
`combinedScore` is now `(taste × 0.4 + story × 0.3 + price × 0.3) × eraPenalty` when personalized, `(story × 0.8 + price × 0.2) × eraPenalty` otherwise. No unbounded terms. Do not reintroduce a multiplicative dislike penalty — this document is the reason why.

### 3. Quality floor
`QUALITY_FLOOR = 0.4` in `scan.ts`: items whose **base** score fails the story test are never sent, regardless of how personalization reorders. Ranking shuffles good items; it cannot resurrect bad ones. (Consistent with the "only filter obvious junk" principle — a 0.25 base *is* story-test-failed junk.)

## Validation (live replays against prod data)

Replays re-invoke the scorer on Mason's real 07-15 pool with his real votes as of that morning. Gemini scoring is stochastic and the original day's scores weren't stored, so these are representative replays, not exact reproductions.

**Old formula replay:** swimsuit #1 (0.098), N-1 Deck Jacket #8 (0.042). All 15 items compressed into 0.03–0.10 where ordering ≈ noise. Reproduces the prod incident.

**New pipeline replay:** floor removes the swimsuit before scoring. Top 3: **N-1 Deck Jacket (taste 0.95), OshKosh chore (0.85), Levi's trucker (0.80)**. The two items prod actually sent and Mason downvoted — Saddlebrook (0.45) and McGregor (0.50) — rank 10th/11th. The scorer discriminated *within* the jacket category: authentic military/workwear vs. generic mall bombers. That contrast is Mason's actual taste, and the old architecture was structurally blind to it (the dislike prompt never saw his likes).

Corroborating signal: Mason upvoted a Dehen N-1 deck jacket on 07-16 — the new scorer's #1 pick type.

## Alternatives considered and rejected

**Like score − dislike score (two simple calls, subtract in code).** Tested on the replay numbers, it fails: in-genre items saturate both scales (0.85–0.95 on both), so the difference is quantization noise. N-1 (his grail): 0.95 − 0.95 = 0.00. Swimsuit: 0.10 − 0.20 = −0.10 — *above* half the jackets. Subtracting two large, nearly-equal, imprecise numbers amplifies noise; the two separate questions simply don't produce the information. Also 2× the API calls.

**Why the single contrastive ask is trusted:** asking for *absolute* similarity to one pile is the hard, anchor-less task (scores drift high). "Here's what he likes, here's what he hates — which is this closer to?" is few-shot classification, the most reliable LLM operation, and the contrast provides the anchor. Empirically it produced clean separation on the first real test.

**Fallback if the single score ever misbehaves:** one call, two arrays — request `likeSimilarity[]` and `dislikeSimilarity[]` in the same structured response (model still sees both lists for anchoring), combine in code, transparently tunable. More debuggable, re-inherits some saturation risk. Hold in reserve; let vote data trigger the switch, not vibes.

## How we're evaluating (ongoing)

1. **Mason watch (started 2026-07-16, review ~2026-07-23):** his up/down ratio was 34↑/30↓ lifetime, with recent digests heavily downvoted (3/3 down on 07-17). If the new scorer works, his upvote rate on post-ship digests should rise materially. A scheduled check runs in a week.
2. **Logs:** every scan logs `Taste scores: [...]` per user — uniform arrays (all ~0.9 or all ~0.5) mean the contrast isn't landing; spread means it is.
3. **Backtest (when vote volume grows):** replay past digests per user and measure "does the scorer rank upvoted items above downvoted ones?" — the Mason replay was this with n=1. Worth building as a script once there are a few hundred votes across users.

## Open questions

- Taste drift: votes are taken newest-first (last 40). Is that window right? A collector's taste evolves; old votes may mislead.
- The reference items are summarized as `identification — styleGuide` one-liners. Richer summaries (era, brand, price band) might sharpen the contrast; more tokens.
- `QUALITY_FLOOR = 0.4` is a first guess. Watch for days where it empties small pools (digest skipped) — that's it working as intended unless it happens often.
- The 40/30/30 weights predate the contrastive score. With a trustworthy taste signal, 0.4 may be too timid — revisit after the Mason experiment.

## Related: size matching

The same session shipped size matching (dual-channel tag/measurement extraction with corroboration, resolution, and per-user fit). It's documented in CLAUDE.md; the shared philosophy is the one worth restating here: **only confirmed evidence may delete an item; weak or contradictory evidence may only demote.** That rule now governs both size exclusion and taste ranking.
