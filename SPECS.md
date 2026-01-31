# Vintage Searcher - Specs Discussion

## Overview
A background service that scans online marketplaces for underpriced true vintage clothing (pre-1980s). The core assumption is that LLMs have deeper knowledge about vintage clothing value than average sellers, allowing us to identify arbitrage opportunities.

## Goals
- Continuously scan listings for vintage clothing
- Identify items that are underpriced relative to their true value
- Alert when profitable opportunities are found

## Scope
- **Era**: Pre-1970s ("true vintage")
- **Category**: High-value clothing items
- **Strategy**: Find margin between listing price and actual market value

---

## Marketplaces (High Opportunity Only)

| Platform | Why High Opportunity | API Status | Notes |
|----------|---------------------|------------|-------|
| **eBay** | Massive volume, auction format surfaces underpriced items, casual sellers mixed with pros | Official API available | Best starting point for MVP - API access + volume |
| **ShopGoodwill.com** | Actual thrift stores auctioning online. Staff do quick descriptions, not vintage experts. Auction format means less competition on obscure items | No official API (scraping required) | Very high potential - true thrift store pricing online |
| **Shop The Salvation Army** | Same model as ShopGoodwill - thrift store staff pricing items, auction format | No official API (scraping required) | Pairs well with ShopGoodwill, similar scraping approach |
| **EBTH (Everything But The House)** | Online estate sales - families/estates often don't know vintage clothing value. Auction format | No official API (scraping required) | Estate sales are goldmines for overlooked vintage |
| **HiBid** | Auction aggregator (17M+ monthly visits) - local auction houses posting online. Antiques, estates, collectibles | No official API (scraping required) | Aggregates many small auction houses who may not know vintage |
| **Vinted** | 65M+ users, huge in Europe. No seller fees attracts very casual sellers cleaning out closets. European sellers may have inherited pieces they don't recognize | No official API (scraping required) | EU shipping adds complexity but less saturated with US resellers |
| **Depop** | Younger demographic focused on streetwear may not recognize true pre-1980s vintage value | No official API (scraping required) | Good for catching vintage pieces miscategorized as "retro" |

**Strategy:**
- Phase 1 (MVP): eBay - has API, proves the concept
- Phase 2: Add ShopGoodwill.com + Salvation Army via scraping - highest untapped opportunity
- Phase 3: EBTH + HiBid - estate sale / auction house expansion
- Phase 4: Vinted/Depop for broader coverage

---

## Moonshot: Japan Market Expansion

Japan has the world's largest secondhand designer goods market with strict anti-counterfeit laws and historically lower prices. High complexity but potentially high reward.

| Platform | Opportunity | Challenges |
|----------|-------------|------------|
| **Yahoo Japan Auctions** | Massive volume, authentic pieces, less competition from Western resellers | Requires proxy service (Buyee, Zenmarket), Japanese keywords, currency/shipping |
| **Mercari Japan** | Japan's largest flea market app, casual sellers, hidden gems | Requires proxy service, Japanese search terms, sizing differences |

**Requirements for Japan expansion:**
- Proxy service integration (Buyee, Zenmarket, Sendico)
- Japanese keyword research (e.g., "古着" = vintage clothes)
- Currency conversion + international shipping cost calculations
- Understanding Japanese sizing vs Western sizing

---

## Architecture Decision: Cron Job

**Chosen approach:** Simple cron job that runs every N minutes

**How it works:**
1. System cron triggers `node scan.js` at fixed intervals (e.g., every 5 minutes)
2. Script fetches a fixed number of listings (e.g., 50 or 100 per run)
3. Evaluates all listings with LLM, stores results in database
4. Sends alerts for any high-opportunity finds discovered
5. Script exits after completing all listings - next run starts fresh

**Why this approach:**
- Simple to build, debug, and deploy
- Vintage deals don't disappear in seconds (unlike sneaker drops)
- Easy to run locally or on any cheap VPS
- If a run fails, next one starts clean
- Fixed scan count makes LLM costs predictable
- Can upgrade to polling service later if speed becomes an issue

---

## LLM Strategy

### Two-Pass Filtering

| Pass | Model | Purpose | Action |
|------|-------|---------|--------|
| **Pass 1** | Gemini 2.0 Flash | Cheap/fast filter to eliminate obvious non-vintage | Store URLs that pass for future filter iteration |
| **Pass 2** | Gemini 1.5 Pro (with vision) | Deep evaluation with photos, pricing, references | Full analysis + alerts |

**Pass 1 filters (examples):**
- Price > $500? Skip (seller likely knows value)
- Keywords like "reproduction", "costume", "retro style"? Skip
- No photos? Skip
- Wrong category? Skip

**Why store Pass 1 URLs:** Enables future iteration on filter rules by reviewing what passed/failed.

### Vision Model

**Required.** For pre-1980s vintage, valuable signals are visual:
- Labels/tags (union labels, care tags, brand logos)
- Stitching patterns (single vs chain stitch)
- Hardware (zippers - Talon, Crown vs modern YKK)
- Fabric patterns and construction
- Condition details in photos

### LLM Output Structure

```typescript
{
  isAuthentic: boolean,          // Is this actually pre-1980s?
  estimatedEra: string,          // e.g., "1960s" or "early 1970s"
  estimatedValue: number,        // What it could sell for
  currentPrice: number,          // Listed price
  margin: number,                // Potential profit
  confidence: number,            // 0-1 score
  reasoning: string,             // Why the LLM thinks it's valuable/authentic
  redFlags: string[],            // Potential issues (stains, repairs, mislabeled era, etc.)
  references: string[]           // Comparable sales, known labels, pricing sources
}
```

### Pricing Validation

LLM provides its own pricing estimate with references (comparable sales, known market values). No external validation API needed for MVP - the `references` field shows the LLM's reasoning for the price.

---

## Tech Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| **Language** | TypeScript | Type safety for complex listing data, good ecosystem for APIs + scraping |
| **Runtime** | Node.js | Run via system cron |
| **Database** | SQLite (MVP) | Simple, no server needed. Upgrade to Postgres later if needed |
| **ORM** | Prisma or Drizzle | Type-safe database access |
| **eBay API** | ebay-api (npm) | Official eBay Node.js SDK |
| **Web Scraping** | Playwright | For platforms without APIs (ShopGoodwill, etc.) |
| **HTTP Client** | axios or fetch | For API calls |
| **LLM** | Gemini API | Pass 1: Gemini 2.0 Flash (cheap filter). Pass 2: Gemini 1.5 Pro (vision + deep analysis). SDK: @google/generative-ai |
| **Hosting** | TBD | Local machine, VPS, or cloud |
| **Notifications** | TBD | Discord webhook, email, or SMS |

## Next Steps
1. ~~Pick initial marketplace(s)~~ → eBay (MVP)
2. ~~Decide on service architecture~~ → Cron job
3. ~~Choose tech stack~~ → TypeScript
4. ~~Decide on LLM strategy~~ → Gemini (2.0 Flash + 3.0 Pro), two-pass filter, vision
5. Set up project scaffolding (TypeScript, Prisma, eBay SDK)
6. Prototype the LLM evaluation prompt
7. Build MVP scanner for eBay

---

## Notes
*Add any additional thoughts here*
