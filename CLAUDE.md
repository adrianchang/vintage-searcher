# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A daily vintage clothing digest service. It scans eBay for vintage listings, uses Gemini AI to identify and value items, generates editorial stories, and emails personalized digests to subscribers each morning. It also posts a daily summary to Threads (@vintage.stories).

**Production URL:** `https://vintage-searcher.onrender.com`
**Deployed on:** Render (free tier — server spins down when idle, cold starts are slow)

## Commands

```bash
npm run server        # Start the Express server locally
npm run scan          # Run the scan pipeline once from the CLI (src/index.ts, maxListings: 30, no server)
npm run test          # Run all tests (vitest)
npx vitest run src/scan.test.ts   # Run a single test file
npm run db:migrate    # Create a new migration (dev)
npm run db:studio     # Open Prisma Studio (local DB browser)
```

Set `USE_MOCK_DATA=true` to run the pipeline against mock eBay listings (no eBay API keys needed).

**Trigger a test scan on production** (sends to adrian.aa.chang.aa@gmail.com and adrian.aa.chang@gmail.com only):
```bash
curl -s -X POST "https://vintage-searcher.onrender.com/scan?test=true" \
  -H "x-api-key: VBMc+AXdYT1YAGgKUC/uMnOmT4xL5fn9nFzIJO/GBIo="
```

**Post to Threads manually:**
```bash
curl -s -X POST https://vintage-searcher.onrender.com/threads \
  -H "Content-Type: application/json" \
  -H "x-api-key: VBMc+AXdYT1YAGgKUC/uMnOmT4xL5fn9nFzIJO/GBIo=" \
  -d '{"title":"...","intro":"..."}'
```
This pulls the last 3 story deliveries for `adrian.aa.chang@gmail.com`, looks up the **Chinese** (`zh`) story variants (hardcoded `EN_LANG = "zh"` in server.ts), and posts a carousel to Threads.

## Architecture

### Scan Pipeline (`src/scan.ts`)

The core pipeline, triggered via `POST /scan` (server, maxListings 20; 10 in test mode) or `npm run scan` (CLI, maxListings 30):

1. **Fetch** — `ecommerce.ts` searches eBay via Browse API (price $0–500, condition New→Good, sorted newest first), then enriches each listing with full image sets via `getItem` (parallel). Image URLs are upscaled to `s-l1600.jpg`; listing URLs normalized to `https://www.ebay.com/itm/{id}`.
2. **Filter** — `filter.ts` drops obvious junk (skip keywords like "reproduction"/"lot of", min price $10, min 2 images, seller-defined variation listings)
3. **Identify** — `evaluate.ts:runIdentification` sends up to 12 images + listing data (including seller item specifics) to Gemini with the `googleSearch` tool (Phase 1). Produces English + Japanese search labels plus a `sizing` block (garment type, labeled size, pit-to-pit/waist measurements with evidence type + quote). Cached in `Evaluation` table by URL — runs once per listing ever.
4. **Value** — `evaluate.ts:runValuation` runs 4 parallel Vertex AI Search (searchLite) queries for comps — English sold/active + Japanese sold (落札)/active — then Gemini visits the URLs via the `urlContext` tool to extract real prices (JPY converted at ~150/USD). Also cached.
5. **Story** — `evaluate.ts:runStory` generates editorial hook/mainStory/styleGuide per (language, archetypeConfigId). Sends the first 2 listing images (visual grounding for styleGuide) and uses the `googleSearch` tool, with three reference stories in the prompt setting tone/length. Cached in `Story` table.
6. **Score** — `score.ts:combinedScore` weights price + story scores. Personalized via vote history and archetype profile. If the user has a size profile, a size gate runs first: confirmed size mismatches are dropped, unknown sizes get a ×0.85 score penalty (see Size Matching below).
7. **Email** — top 3 per user sent via Resend (`email.ts`); deliveries recorded in `StoryDelivery` so items are never resent.

Keyword weights are distributed across `maxListings` using the largest-remainder method (`scan.ts:resolveKeywordCounts`). **Gotcha:** if `maxListings` is small relative to the number of active queries, low-weight queries silently get count=0 and are never searched. Safe at current settings (20 listings / max 15 queries) — add a floor of 1 if you change either.

### Gemini Calls (`src/services/evaluate.ts`)

All calls go through `callGemini` using model `gemini-3.1-flash-lite`, structured JSON output via `responseJsonSchema`:
- Global throttle: 15s minimum between requests (~4/min)
- 3 retries with exponential backoff on 429/network errors
- Grounding reference URLs are extracted from response metadata (redirects resolved)

Personalization scoring (`computeTasteScores`) is **contrastive**: one call per user per scan that sees up to 20 liked AND 20 disliked items together (from the last 40 votes) and scores each candidate 0–1 by which side of the voting history it resembles. Likes and dislikes are usually the same garment category, so the prompt explicitly directs the model to judge what *differs* between the lists (era, authenticity, brand caliber), not category similarity. Falls back to the archetype `scoringContext` on cold start.

### Scoring (`src/services/score.ts`)

- Base: `story × 0.8 + price × 0.2`
- Personalized (when votes or archetype profile exist): `taste × 0.4 + story × 0.3 + price × 0.3` — taste is the contrastive score (dislikes are folded in; there is deliberately NO separate dislike multiplier — it let out-of-distribution junk outrank great in-genre items by evading the penalty)
- Era penalty: items from 2010s or later get ×0.7
- Quality floor (`scan.ts` QUALITY_FLOOR = 0.4): items whose *base* score fails the story test are never sent, regardless of how personalization would reorder them
- Size-unknown penalty (only when the user has a size profile): ×0.85, applied in `scan.ts` after personalization

### Size Matching (`src/services/size.ts`)

Men's/unisex only by design. Everything converges on inches — flat pit-to-pit for tops, tag waist for bottoms. All tolerances/chart values are named constants in this one module.

- **Extraction** happens in Phase 1 identification via two independent processes, each with a photo channel and a text channel: TAG (`tagFromPhoto` / `tagFromText`+quote) and MEASUREMENT (`photoPitToPit/Waist` / `textPitToPit/Waist`+quote). `resolveGarmentSize` confirms them in code: text channels must be corroborated against title+description+aspects (quote with matching number, or token/regex hit); each process reconciles its channels (photo vs text **contradiction → abort**); finally the confirmed tag and confirmed measurement are cross-checked via the chart (± slack, vintage-shifted) — disagreement discards sizing entirely (`resolution: "contradicted"`). Whatever survives is *confirmed* — there is no confidence score at runtime. Persisted on `Evaluation`: `garmentType`, `labeledSize`, `pitToPitInches`, `waistInches`, `sizeEvidence` (the resolution: `tag+measurement|tag|measurement|contradicted|none`), plus `sizeRaw` (raw four-channel block, audit trail). `sizeConfidence` is legacy, no longer written.
- **User profile** on `User`: `topSize` (XS–XXL), `waistSize`, optional `pitToPitInches` refinement. Set via `/subscribe` (signup page has an optional size section with in/cm toggle). All nullable — no profile means no size logic at all.
- **Matching** (`computeSizeFit`, called per-user in `scan.ts`): everything reaching it is confirmed, so clear misses always exclude. *Measurements* match against the user's band (asymmetric tolerance, outerwear gets extra room on measured garments). *Tags* match by size distance: within ±1 chart size of the user (pre-90s labels count one size smaller) → match, 2+ sizes away → mismatch, unparseable → unknown; bottoms on tag waist (≤1.5" match, ≥3" mismatch, between → unknown). Verdicts: `match` / `mismatch` (dropped) / `unknown` (×0.85 penalty + "size unverified" note in the email) / `not_applicable` (footwear, dresses, or user lacks that dimension — neutral). Legacy pre-feature evaluations are `not_applicable` (neutral), never penalized. Resolution + fit are pure functions of stored data — every decision is replayable from `sizeRaw` + the columns for auditing.
- `ecommerce.ts` getItem enrichment also captures `localizedAspects` into `rawData.aspects` and swaps the truncated `shortDescription` for the full stripped item description — both feed the identification prompt.

### Archetypes (`src/configs/archetypes.ts`)

Users pick up to 3 archetypes at signup. Each archetype has:
- `keywords` — eBay search queries with percentage weights (must sum to 1.0)
- `promptContext` — appended to the Gemini **story** prompt to shape the narrative for that aesthetic
- `scoringContext` — passed to personalization scoring for cold-start (no vote history yet)

`buildArchetypeConfigId(ids)` produces a stable slug (e.g. `"biker+ivy"`) used as `Story.configId` — so story variants are cached per archetype combination, not per user.

`"en-default"` configId means no archetypes selected (falls back to DEFAULT_KEYWORDS). It's a misnomer — it means "no archetypes", not "English"; renaming requires a prod DB migration.

`mergeArchetypeKeywords` averages weights for queries shared by multiple archetypes, then renormalizes to 1.0.

### Server Endpoints (`src/server.ts`)

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /` | — | Serves `public/signup.html` |
| `POST /subscribe` | — | Upserts user by email; atomically replaces `UserKeyword` + `UserArchetype` (max 3 archetypes); accepts optional `topSize`/`waistSize`/`pitToPitInches` (absent = unchanged, null = cleared); never touches votes/deliveries |
| `GET /vote` | HMAC token | Records thumbs up/down from email links; upserts (last click wins) |
| `POST /scan` | `x-api-key` | Kicks off `runScan` async; `?test=true` limits to 10 listings + test recipients |
| `POST /threads` | `x-api-key` | Posts last 3 deliveries to Threads |
| `GET /threads/auth` → `GET /threads/callback` | — | Threads OAuth; callback page displays the long-lived token to copy into Render env vars |
| `GET/POST /ebay/webhook` | — | eBay marketplace account deletion challenge/ack |
| `GET /ebay/auth/callback` | — | Required by eBay OAuth flow — do not remove |

### DB Schema Key Points

- `Evaluation` — one row per eBay URL. Cached identification + valuation. Never re-evaluated. `redFlags`/`references`/`soldListings` are JSON strings.
- `Story` — one row per `(evaluationId, language, configId)`. Re-generated if archetype combo or language changes.
- `StoryDelivery` — tracks what has been sent to each user. Prevents resending.
- `Vote` — thumbs up/down per `(userId, storyId)`. Used to personalize future rankings.
- `UserKeyword` — per-user eBay search queries. Replaced entirely on re-signup.
- `UserArchetype` — which archetypes a user selected.
- `session` — managed by connect-pg-simple, not Prisma.

The Prisma client is generated into `src/generated/prisma` (checked into git, custom output path). Import from `./generated/prisma/client`. Never edit generated files.

### Threads Posting (`src/services/threads.ts`)

`postToThreads(title, intro, items, accessToken)` posts a carousel (one image per item, topic_tag 古著) + one text reply with the first item's story (truncated to fit the 500-char limit). Containers are polled until `FINISHED` before publishing.

**Token lifecycle (self-refreshing):** the long-lived token (~60-day expiry, refreshable only while still valid) lives in the `AppCredential` table, seeded from the `THREADS_ACCESS_TOKEN` env var. `resolveThreadsToken(prisma)` validates it (`/me`), refreshes it when >24h old (`refresh_access_token`, +60 days), and persists the result; the `/scan` handler calls it fire-and-forget so the daily cron keeps the token alive forever. `POST /threads` resolves + validates the token BEFORE returning "ok" (a dead token used to fail silently after the 200 response). If the token ever fully dies (service down 60+ days), re-mint via the Meta portal **User Token Generator** (not the `/threads/auth` OAuth flow) for the brand account and update the env var — the store re-seeds automatically. `THREADS_USER_ID` stays an env var.

### Email Template (`src/services/email.ts`)

HTML digest email, localized en/zh. Layout per item: era tag → image → eBay button (full-width) → hook quote → price block → story → style guide → feedback card (thumbs up/down). Vote URLs are HMAC-signed (`VOTE_SECRET`). Without `RESEND_API_KEY` set, emails are logged instead of sent.

## Environment Variables

See `.env` for local values. Production vars set on Render. Key ones:
- `GEMINI_API_KEY` — Gemini API (identification, valuation, story generation)
- `EBAY_APP_ID` / `EBAY_CERT_ID` — eBay Browse API
- `SCAN_API_KEY` — protects `/scan` and `/threads` endpoints
- `THREADS_USER_ID` / `THREADS_ACCESS_TOKEN` — Threads posting credentials (+ `THREADS_APP_ID` / `THREADS_APP_SECRET` for the OAuth flow)
- `RESEND_API_KEY` — email sending (logs instead of sending when unset)
- `VERTEX_ENGINE_ID` / `VERTEX_API_KEY` — Vertex AI Search for comp lookups (`GCP_PROJECT_ID` defaults to `vintage-searcher`)
- `VOTE_SECRET` — HMAC signing for vote URLs
- `APP_URL` — base URL used in vote links (defaults to localhost:3000)
- `DATABASE_URL` — PostgreSQL
- `USE_MOCK_DATA` — use mock eBay listings instead of the real API

## Known Stale Code

- `prisma/seed.ts` references a removed `searchQuery` model — `npm run db:seed` is broken.
- `src/services/notify.ts` + `scripts/test-discord.ts` — legacy Discord alerting, not used by the current pipeline.
- `SPECS.md` — original arbitrage-focused spec; historical context only, the product has since pivoted to the digest/story model.

## Archetype Images

Card images for the signup page live in `public/images/archetypes/[id].jpg` (3:4 ratio works best).
