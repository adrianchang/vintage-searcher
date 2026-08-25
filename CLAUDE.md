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
curl -s -X POST "https://vintage-searcher.onrender.com/threads?account=zh" \
  -H "Content-Type: application/json" \
  -H "x-api-key: VBMc+AXdYT1YAGgKUC/uMnOmT4xL5fn9nFzIJO/GBIo=" \
  -d '{"title":"...","intro":"..."}'
```
`?account=zh` (default, matches existing automation) pulls the last 3 story deliveries for `adrian.aa.chang@gmail.com` and posts the `zh` story variants to **@bear.7306501**. `?account=en` pulls from `adrian.aa.chang.aa@gmail.com` and posts the `en` variants to **@wolf.2833331** (added 2026-08-19, the English-audience account — see Threads Posting below).

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

Keyword weights are distributed across `maxListings` using the largest-remainder method (`scan.ts:resolveKeywordCounts`). **Gotcha:** if `maxListings` is small relative to the number of active queries, low-weight queries silently get count=0 and are never searched. Safe at current settings (20 listings / ~9 active queries for a typical multi-archetype user post-rotation) — add a floor of 1 if you change either.

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

**Daily keyword rotation (2026-08-15):** each archetype's `keywords` pool is deliberately long (specific, narrow terms — e.g. `vintage M-65 field jacket`, `vintage bleu de travail`, `vintage perfecto jacket` — not generic ones) rather than a handful of broad terms. Running the whole pool every day would thin allocation badly (a 3-archetype user would hit dozens of simultaneous queries against `maxListings`=20); instead `selectActiveKeywords` picks a small deterministic round-robin window (`KEYWORD_ROTATION_WINDOW`=3 per archetype) that advances by the window size each day and wraps around, guaranteeing every keyword gets a turn over a cycle while keeping the *active* set small enough that each query gets a real allocation. Same day + same archetype combo always resolves identically, so users sharing a config also share the eBay fetch (existing per-scan query dedup still applies). **Important:** `mergeArchetypeKeywords(archetypeIds, dayIndex)` — the `dayIndex` argument is what triggers rotation; `scan.ts` computes it fresh every run and calls this directly for any user with archetypes selected, **ignoring the `UserKeyword` rows `/subscribe` persisted** (that snapshot predates rotation and is now only read as a fallback for archetype-less users). If you ever see stale/repetitive keyword behavior again, check that scan.ts is still calling `mergeArchetypeKeywords` fresh rather than reading `user.keywords`.

**Round-2 coverage pass (2026-08-16):** the 2026-08-15 pools were built in one single-pass research effort and, on audit, had systematic blind spots — some archetypes were 100% one garment type (Military was all jackets, Cowboy all shirts, European Workwear all outerwear) and most had zero or near-zero named heritage brands despite `promptContext`/`scoringContext` explicitly caring about brand authentication. Ran 10 parallel research agents (one per archetype) to independently audit gaps against each culture's real collector terminology. Findings were reviewed and approved before implementation; footwear was explicitly scoped out (deliberately out of the product for now, even though 6/10 agents flagged it). Pools grew to their current sizes: americana 31, ivy 24, military 34, european-workwear 28, cowboy 32, biker 31, reggae 15, british-mod 22, sportswear 29, rockabilly 20. `KEYWORD_ROTATION_WINDOW` stayed at 3 — a bigger pool just means a longer full-coverage cycle, which is the intended effect, not a reason to widen the daily window. Cross-archetype duplicate terms are fine and expected (e.g. `vintage barbour international jacket` appears in both European Workwear and Biker); the enforced invariant is no duplicates *within* a single archetype's pool (see `archetypes.test.ts`).

`mergeArchetypeKeywords` averages weights for queries shared by multiple archetypes, then renormalizes to 1.0.

### Server Endpoints (`src/server.ts`)

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /` | — | Serves `public/signup.html` |
| `POST /subscribe` | — | Upserts user by email; atomically replaces `UserKeyword` + `UserArchetype` (max 3 archetypes); accepts optional `topSize`/`waistSize`/`pitToPitInches` (absent = unchanged, null = cleared) and optional `photoBase64`/`photoMimeType` (absent = unchanged, no clear-via-null support); never touches votes/deliveries |
| `GET /vote` | HMAC token | Records thumbs up/down from email links; upserts (last click wins) |
| `GET /go` | HMAC token | eBay-button click redirect: records an `EngagementEvent` (type `click`), then 302s to the listing URL |
| `GET /evaluations/:id/image` | — | Serves the background-removed hero image (bytes from DB); 302s to the original listing image if none was generated |
| `POST /photo` | HMAC token (`photo:{email}`) | Photo upload/replace — called by `/subscribe`'s form and by `/tryon`'s inline upload form (no standalone upload page anymore) |
| `GET /tryon` | HMAC token (`{email}:{storyId}:tryon`) | AI virtual try-on — see Virtual Try-On below |
| `POST /scan` | `x-api-key` | Kicks off `runScan` async; `?test=true` limits to 10 listings + test recipients |
| `POST /threads` | `x-api-key` | Posts last 3 deliveries to Threads |
| `GET /threads/auth` → `GET /threads/callback` | — | Threads OAuth; callback page displays the long-lived token to copy into Render env vars |
| `GET/POST /ebay/webhook` | — | eBay marketplace account deletion challenge/ack |
| `GET /ebay/auth/callback` | — | Required by eBay OAuth flow — do not remove |

### Virtual Try-On (`src/services/tryon.ts`, added 2026-08-22)

AI-generated image of a user wearing one listing per day, rendered onto their own uploaded photo. Two purposes: engagement/shareability, and a richer preference signal than a thumbs up/down (which item someone actually wants to see on themselves).

- **Photo storage**: `User.photoBytes`/`photoMimeType`/`hasPhoto`, same bytes-in-Postgres pattern as `Evaluation.heroImageBytes`. New users set it in `/subscribe`; existing users set/replace it inline on `/tryon` (see below). `MAX_PHOTO_BYTES` (6MB) and `express.json({ limit: "10mb" })` in `server.ts` bound upload size.
- **Client-side compression before upload** (added 2026-08-24, fixed a real bug): both upload entry points (`signup.html`, `/tryon`'s inline form) resize to 1600px on the longest edge and re-encode as JPEG via canvas before sending — phone cameras routinely produce 8-15MB+ originals, well past what the server accepts, and Gemini doesn't use more input detail than this anyway. Falls back to the uncompressed original if canvas compression fails for any reason, rather than blocking upload. Server-side, a 4-arg error-handling middleware (registered last, after all routes) catches body-parser size-limit errors and returns a real `{error}` JSON message instead of Express's default HTML error page — without it, oversized uploads made the client's `await res.json()` throw and show a generic, unhelpful error with no hint it was a size problem. `decodePhotoUpload` also returns a specific reason (`"too large"` vs `"not a valid image"`) instead of a single vague message.
- **Email entry point**: the digest always leads with a "Today's Pick" numbered text list (`buildTryOnPickerHtml`) *before* the intro line, regardless of whether the user has a photo yet — deliberately front-loaded so the pick doesn't require reading the whole email first, and deliberately text-only (no thumbnails) since pictures up top risked picture-then-bounce behavior that skips the actual stories below. Copy leans into the once-a-day limit as a game ("you get one shot today — choose wisely"). Each item name links to `GET /tryon?e=&s=&t=` (HMAC-signed like vote/click links, `buildTryOnUrl` in `email.ts`).
- **No separate photo-upload step or nudge banner** (removed 2026-08-23, same day it briefly existed) — showing the picker unconditionally already solves discoverability, and gating it behind `hasPhoto` created a real staleness bug: `hasPhoto` used to only get read once, at that day's scan time, so uploading a photo mid-day meant waiting until *tomorrow's* email to see the picker. Fixed by making `/tryon` itself photo-aware in real time: if `!user.hasPhoto`, it renders an upload form **inline on the same page** (same email/storyId/token already in the URL) instead of redirecting anywhere; on successful `POST /photo` the page just does `location.reload()`, and since `hasPhoto` is now true the reload runs straight into generation. One click, no second URL to construct, no return-path/redirect state to track.
- **Generation** (`generateTryOn` in `tryon.ts`): `gemini-3.1-flash-image` — the same model Google's own shopping virtual try-on feature runs on — given the user's photo + the item's image (background-removed hero image when available, same `hasProcessedImage` fallback logic as everywhere else) and a prompt asking for a photorealistic composite preserving identity/pose/background, with explicit instructions to keep layered clothing visible (a real failure mode found in testing: garments normally worn over other clothing, like overalls, would otherwise render the person bare underneath).
- **Deliberately NOT on evaluate.ts's shared 15s scan throttle** — that throttle exists for an unattended batch job; this is a live request with a real user waiting on a page load. Fail-fast by design: one attempt, no retries/backoff (`generateTryOn` returns `null` on any failure).
- **Rate limit**: one successful try-on per user per UTC calendar day (`startOfUtcDay` — same day-boundary convention as `archetypes.ts`'s `dayIndex`). Enforced by querying `TryOn` rows with `status: "done"` created since the start of today; a **failed** generation doesn't consume the day's allowance, so a Gemini error never costs the user their try. Re-clicking the same item's link the same day shows the cached result instead of regenerating; clicking a different item after already succeeding today shows a "come back tomorrow" page.
- **Result page**: rendered inline by `GET /tryon` (not a stored/cached public URL) — the generated image is embedded as a base64 data URI directly in the HTML response, since each result is a one-off view tied to a signed link rather than something needing CDN-style caching.
- **Changing your photo** (added 2026-08-24): a "Not you? Update your photo" link on every result/status page appends `&changePhoto=1` to that same `/tryon` URL, which forces the inline upload form even when `hasPhoto` is already true. `POST /photo` is a plain upsert, so re-uploading always replaces the stored photo — but the daily-limit check runs purely on `TryOn` rows keyed by `(userId, day)` and never looks at which photo was used, so re-uploading can't grant an extra generation; if today's try-on is already done, re-uploading a photo and reloading just shows that same cached result again. Verified locally: reupload succeeds, the photo bytes actually change in the DB, and a second `/tryon` hit afterward stays at exactly one `TryOn` row (no regeneration, instant response).
- **Logging**: `TryOn` rows only capture completed attempts (done or failed generation). Every `GET /tryon` hit — including ones blocked by the daily limit or a missing photo — also fires an `EngagementEvent` (`type: "tryon_click"`, fire-and-forget, same non-blocking pattern as `/go`'s click logging) so "wanted to try this on" is never lost just because the request got blocked before generation. This is the intended future personalization signal — a stronger preference indicator than a vote — even though nothing reads it yet.

### DB Schema Key Points

- `Evaluation` — one row per eBay URL. Cached identification + valuation. Never re-evaluated. `redFlags`/`references`/`soldListings` are JSON strings.
- `Story` — one row per `(evaluationId, language, configId)`. Re-generated if archetype combo or language changes.
- `StoryDelivery` — tracks what has been sent to each user. Prevents resending.
- `Vote` — thumbs up/down per `(userId, storyId)`. Used to personalize future rankings.
- `UserKeyword` — per-user eBay search queries. Replaced entirely on re-signup.
- `UserArchetype` — which archetypes a user selected.
- `TryOn` — one row per virtual try-on attempt (`status: "done" | "failed"`, bytes only on success). See Virtual Try-On above for the once-per-day rule this enables.
- `session` — managed by connect-pg-simple, not Prisma.

The Prisma client is generated into `src/generated/prisma` (checked into git, custom output path). Import from `./generated/prisma/client`. Never edit generated files.

### Threads Posting (`src/services/threads.ts`)

**Two accounts, one per audience language** (added 2026-08-19): `zh` = **@bear.7306501** (original, Taiwan/Chinese audience), `en` = **@wolf.2833331** (English audience, growth push toward the first 100 users). Both post through the same Meta developer app (`THREADS_APP_ID`/`THREADS_APP_SECRET`) — no second app was created, `wolf.2833331` was just added as an Instagram tester on the existing app. Everything account-specific is keyed off a `ThreadsAccount = "zh" | "en"` type; `ACCOUNT_CONFIG` in `threads.ts` maps each to its own `THREADS_USER_ID`/`THREADS_USER_ID_EN` env var, `THREADS_ACCESS_TOKEN`/`THREADS_ACCESS_TOKEN_EN` env var, `AppCredential` storage key (`threads_access_token` / `threads_access_token_en`), and topic tag (`古著` / `vintage`). `server.ts`'s `THREADS_ACCOUNTS` map is the business-logic side: which source email's deliveries and which story `language` each account posts (`zh` → `adrian.aa.chang@gmail.com`/`zh`, `en` → `adrian.aa.chang.aa@gmail.com`/`en`).

`postToThreads(title, intro, items, accessToken, account)` posts a carousel (one image per item) + one text reply with the first item's story (truncated to fit the 500-char limit). Containers are polled until `FINISHED` before publishing. `POST /threads?account=en|zh` (defaults to `zh` so existing automation calling it with no query param is unaffected) resolves the account's config, looks up its source user's last 3 `StoryDelivery` rows, and pulls the matching-language `Story` row per item.

**Token lifecycle (self-refreshing, per account):** each account's long-lived token (~60-day expiry, refreshable only while still valid) lives in its own `AppCredential` row, seeded from its env var. `resolveThreadsToken(prisma, account)` validates it (`/me`), refreshes it when >24h old (`refresh_access_token`, +60 days), and persists the result; the `/scan` handler calls it fire-and-forget **for both accounts** so the daily cron keeps both tokens alive forever. `POST /threads` resolves + validates the relevant account's token BEFORE returning "ok" (a dead token used to fail silently after the 200 response). If a token ever fully dies (service down 60+ days), re-mint via the Meta portal's per-tester **"Generate Token"** button (found under the app's Threads API Setup page, not the `/threads/auth` OAuth flow — that flow's auth codes are single-use and prone to being consumed by link prefetching before the real browser tab lands) and update the corresponding env var — the store re-seeds automatically.

### Email Template (`src/services/email.ts`)

HTML digest email, localized en/zh. Layout per item: era tag → image → price + vote row → size line → eBay button (full-width) → hook quote → story → style guide → feedback card (thumbs up/down) — price moved above the CTA (2026-08-10). Vote URLs are HMAC-signed (`VOTE_SECRET`); the eBay button routes through `GET /go` (same HMAC scheme, "click" pseudo-direction) so click-throughs are recorded as `EngagementEvent` rows before redirecting. Without `RESEND_API_KEY` set, emails are logged instead of sent.

**Compact layout (2026-08-13, tuned 2026-08-14):** price and the 👍/👎 vote links share one quiet single-line row (plain text on the page background, no card) instead of separate full-width blocks — research-backed call: the isolation/Von Restorff effect means a price card styled like the eBay button competes with it rather than reinforcing it, so the CTA is now the only bold dark element per item. Price numbers were sized up on 2026-08-14 (22px) for legibility while staying box-free, so the hierarchy still holds. This also moves voting earlier (right after image + price, before the story) — a closer-to-gut-reaction signal than the old post-story feedback card; worth watching in vote data. `styleGuide` renders via `firstSentence()` (trims to the first sentence, hard-capped) since the generation prompt now asks for one tight sentence — older cached stories written under the old (longer) prompt get trimmed at render time, never regenerated. Red flags (`Evaluation.redFlags`) are still identified and stored every scan but no longer rendered in the email (2026-08-14) — users didn't care; the data stays available for future use (e.g. a size/authenticity gate) without a schema change.

**Hero image background removal:** at evaluation-creation time (`scan.ts`), `runBackgroundRemoval` (in `evaluate.ts`) sends the listing's first image (`listing.imageUrls[0]` only — the other listing photos are untouched) to `gemini-3.1-flash-image` via `generateContent` (same API key, same throttle queue as identification/valuation/story — no Vertex AI setup) requesting a pure white studio backdrop. (A side-by-side test on 2026-08-10 initially picked a soft gray over white/cream; overridden back to white after reviewing real production output the same day — 8 evaluations from that window carry the gray version permanently, since results are never regenerated once cached.) Best-effort only — never blocks evaluation creation on failure. Result is stored as raw bytes on `Evaluation.heroImageBytes`/`heroImageMimeType`/`hasProcessedImage`, generated once per listing forever (same caching tier as identification, not per story/config — the same photo is reused across every archetype/language variant). Bytes are deliberately excluded (`omit`) from the routine per-user cache-check query in `scan.ts` since they're a multi-hundred-KB payload hit on every (user, listing) pair; only `GET /evaluations/:id/image` fetches them, falling back to the original `imageUrl` if generation never succeeded (legacy rows, or failures).

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
