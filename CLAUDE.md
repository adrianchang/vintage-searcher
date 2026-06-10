# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A daily vintage clothing digest service. It scans eBay for vintage listings, uses Gemini AI to identify and value items, generates editorial stories, and emails personalized digests to subscribers each morning. It also posts a daily summary to Threads (@vintage.stories).

**Production URL:** `https://vintage-searcher.onrender.com`
**Deployed on:** Render (free tier — server spins down when idle, cold starts are slow)

## Commands

```bash
npm run server        # Start the Express server locally
npm run test          # Run all tests (vitest)
npx vitest run src/scan.test.ts   # Run a single test file
npm run db:migrate    # Create a new migration (dev)
npm run db:studio     # Open Prisma Studio (local DB browser)
npm run db:seed       # Seed the database
```

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
This pulls the last 3 story deliveries for `adrian.aa.chang@gmail.com` and posts a carousel to Threads.

## Architecture

### Scan Pipeline (`src/scan.ts`)

The core pipeline, triggered via `POST /scan`:

1. **Fetch** — `ecommerce.ts` searches eBay via Browse API, then enriches each listing with full images via `getItem` (parallel)
2. **Filter** — `filter.ts` drops obvious junk (skip keywords, min price $10, min 2 images)
3. **Identify** — `evaluate.ts:runIdentification` sends up to 4 images + listing data to Gemini (Phase 1). Cached in `Evaluation` table by URL — runs once per listing ever.
4. **Value** — `evaluate.ts:runValuation` searches for comps via Vertex AI Search, then Gemini visits URLs to extract prices (Phase 2). Also cached.
5. **Story** — `evaluate.ts:runStory` generates editorial hook/mainStory/styleGuide per (language, archetypeConfigId). Cached in `Story` table.
6. **Score** — `score.ts:combinedScore` weights price + story scores. Personalized via vote history and archetype profile.
7. **Email** — top 3 per user sent via Resend (`email.ts`)

### Archetypes (`src/configs/archetypes.ts`)

Users pick up to 3 archetypes at signup. Each archetype has:
- `keywords` — eBay search queries with percentage weights (must sum to 1.0)
- `promptContext` — appended to the Gemini **story** prompt to shape the narrative for that aesthetic
- `scoringContext` — passed to personalization scoring for cold-start (no vote history yet)

`buildArchetypeConfigId(ids)` produces a stable slug (e.g. `"biker+ivy"`) used as `Story.configId` — so story variants are cached per archetype combination, not per user.

`"en-default"` configId means no archetypes selected (falls back to DEFAULT_KEYWORDS).

### DB Schema Key Points

- `Evaluation` — one row per eBay URL. Cached identification + valuation. Never re-evaluated.
- `Story` — one row per `(evaluationId, language, configId)`. Re-generated if archetype combo or language changes.
- `StoryDelivery` — tracks what has been sent to each user. Prevents resending.
- `Vote` — thumbs up/down per `(userId, storyId)`. Used to personalize future rankings.
- `UserKeyword` — per-user eBay search queries. Replaced entirely on re-signup.
- `UserArchetype` — which archetypes a user selected.

### Threads Posting (`src/services/threads.ts`)

`postToThreads(title, intro, items)` posts a carousel (one image per item) + one text reply with the first item's story. Uses `THREADS_USER_ID` + `THREADS_ACCESS_TOKEN` env vars (long-lived token, expires ~60 days, set on Render). Token refresh via `/threads/auth` → `/threads/callback`.

### Email Template (`src/services/email.ts`)

HTML digest email. Layout per item: era tag → image → eBay button (full-width) → hook quote → price block → story → style guide → feedback card (thumbs up/down). Vote URLs are HMAC-signed (`VOTE_SECRET`).

## Environment Variables

See `.env` for local values. Production vars set on Render. Key ones:
- `GEMINI_API_KEY` — Gemini API (identification, valuation, story generation)
- `SCAN_API_KEY` — protects `/scan` and `/threads` endpoints
- `THREADS_USER_ID` / `THREADS_ACCESS_TOKEN` — Threads posting credentials
- `RESEND_API_KEY` — email sending
- `VERTEX_ENGINE_ID` / `VERTEX_API_KEY` — Vertex AI Search for comp lookups

## Archetype Images

Card images for the signup page live in `public/images/archetypes/[id].jpg` (3:4 ratio works best).
