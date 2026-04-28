import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import type { Listing, Evaluation } from "../types";

// Set to true to use mock evaluations for testing
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === "true";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "not-set" });

const IDENTIFICATION_PROMPT = `You are a veteran vintage clothing collector and storyteller evaluating an eBay listing. You MUST use Google Search to verify brand/model/era details.

Listing Title: {title}
Listed Price: ${"{price}"}
Description: {description}

You approach this the way an experienced collector would at a flea market — photos first, description second.

STEP 1 — VISUAL INSPECTION
Examine the photos carefully. Do NOT trust the listing title/description blindly — sellers often mislabel items. Determine:
- Category: jacket, shirt, pants, dress, coat, etc.
- Brand: check tags, labels, and logos in photos. Also consider the style, material, and design — some brands have iconic/recognizable construction even without a visible tag.
- Key construction details (check whichever apply to this item type):
  - Tags/labels: brand tag, care tag, union label (ILGWU, ACWA, etc.), Woolmark logo, country of origin, lot/style numbers
  - Material: fabric type, weight, weave, texture
  - Stitching: single-needle vs chain stitch, bartacks, selvedge
  - Construction: hem style, seam type, pocket construction, lining
  - Hardware: buttons (logo'd?), zippers (Talon, Crown, YKK, Ideal, Scovill), snaps, rivets
  - Cut & design: silhouette, collar style, fit era indicators
  - Condition: wear patterns, fading, holes, stains, repairs, patina

STEP 2 — ITEM IDENTIFICATION
Based on your visual inspection, record your identification in itemIdentification as a SHORT label. This will be used as a search query — be as concise as possible while keeping it specific enough to find comps.
- Format: "Brand Model/Style Era" — e.g. "Levi's 501 Big E 60s" or "Pendleton Loop Collar Board Shirt 60s"
- Include era in the label. Keep it tight — drop filler words, sizes, colors unless they define the item.

Also provide itemIdentificationJapanese: the Japanese equivalent search query for this item. Use Japanese brand names where they exist (e.g. リーバイス, ペンドルトン) and natural Japanese clothing terms. Same conciseness standard as itemIdentification.

Set estimatedEra to the decade or range (e.g. "1970s", "1960s-1970s").
Put authenticating details (tags, hardware, stitching, red flags) in the redFlags array and let identificationConfidence reflect your certainty.
Set identificationConfidence (0-1): how sure are you about WHAT this item is? High if tags/labels are clear and construction details match. Low if you're guessing based on limited photos.

STEP 3 — TELL THE STORY
Write the editorial story for this item. You are a veteran collector talking to someone who's in the hobby but might not know this specific brand or detail yet. You're genuinely excited about what makes this piece special — like showing a fellow skater a rare deck they haven't seen before and telling them exactly why it's worth getting hyped about. You assume they understand what good vintage is. You don't need to explain the hobby. But you do get to share the specific thing that makes this one interesting — the construction detail, the era marker, the reason collectors care. Short sentences. Present tense. No passive voice. No overselling.

hook: One or two sentences. Lead with the authenticating detail or the fact that matters most. No scene-setting. No adjectives. Just the thing itself.
Good: "The loop collar disappeared from Pendleton's lineup in 1963. This one has it."
Bad: "Somewhere in postwar America, workers wore shirts built to last a lifetime."

brandStory: 2–3 sentences. The one thing about this brand that a serious collector would actually care about — the specific fact that changes how you see the piece. If you don't know it, fall back to concise brand history. No "quality craftsmanship", no founding-year trivia for its own sake. Use Google Search to get the details right.

itemStory: 2–3 sentences on this specific piece. What the construction details, hardware, stitching, or label are actually telling you. What makes this example stand out — or not. Be honest if it's unremarkable.

historicalContext: 1–2 sentences. Only include this if the cultural moment is genuinely relevant to the piece. No forced connections. If it doesn't add anything real, just state the era plainly.

marketContext: 2–3 sentences. Who's buying this and why — be specific about the collector communities. If it's genuinely sought after, name them. If it's a sleeper, say why it hasn't caught on yet. Don't call everything a grail — most things aren't. No hype, no salesmanship — just what you'd tell a friend before they hit Buy.

styleGuide: 2–3 sentences. How to actually wear this piece today. Describe the fit, color palette, and the cultural aesthetic it belongs to — workwear, Americana, prep, skate, surf, streetwear, etc. Who pulls this off naturally? What wardrobe does it slot into? Be specific and honest — not every piece is for everyone.

storyScore (0–1): How strong is the story, cultural weight, and collector desirability of this item?
- 0.85–1.0: Genuinely iconic. Hard authentication markers. Real collector demand with receipts.
- 0.65–0.85: Solid piece. Known in the right circles, good story, real but not exceptional demand.
- 0.45–0.65: Interesting but niche or light on provenance. Someone specific wants this, not many.
- Below 0.45: Generic. The story isn't there.

storyScoreReasoning: One sentence — what pushed the score where it landed.

{storyLanguageInstruction}`;

const VALUATION_PROMPT = `SPECIAL INSTRUCTION: Think silently if needed. THINK LONG AND HARD ABOUT THIS

You are a veteran vintage clothing collector evaluating comparable sales data.

ITEM IDENTIFIED IN PREVIOUS ANALYSIS:
- Identification: {itemIdentification}
- Estimated Era: {estimatedEra}
- Identification Confidence: {identificationConfidence}
- Red Flags: {redFlags}

Original Listing:
- Title: {title}
- Listed Price: ${"{price}"}

COMPARABLE LISTINGS FOUND (from web search):
{searchResults}

INSTRUCTIONS:
Visit each URL above using your URL context tool. Read the actual listing pages to extract:
- The item title/description
- The sold price (or listed price if not sold)
- Condition and any relevant details

For EACH listing you can verify, add it to soldListings with:
- title: description of the item
- price: the price in USD (null if unknown)
- url: the listing URL

STRICT RULES — follow these exactly:
- Only include a soldListing if you can read a clear, specific price from that URL. No estimates, no averages, no inferences.
- If a URL is a category page, browse page, or search results page with multiple items, you MAY include individual listings you can see on that page — but only if each one has a clear visible price and is actually similar to the item being valued.
- Do NOT fabricate prices. Do NOT assign the same URL to multiple soldListings unless each one genuinely links to a different item.
- If you cannot find at least 1 real comparable price, set estimatedValue to null, margin to null, and confidence below 0.4.

Then produce your valuation:
- Set estimatedValue based ONLY on the real prices you found
- Calculate margin (estimatedValue - currentPrice), or null if estimatedValue is null
- Set priceScore (0-1): how good a deal is this listing price compared to what it's actually worth?
  - Focus purely on value: is this underpriced relative to comparable sold items?
  - 0.8–1.0: significantly underpriced with strong comps supporting a much higher value
  - 0.5–0.8: moderately underpriced with decent comps
  - 0.2–0.5: priced close to market value, thin margin
  - Below 0.2: priced at or above market, or comps are too weak/few to assess
- Set confidence (0-1): high if you found strong, similar comps. Low if comps are weak, dissimilar, or fewer than 1.

{languageInstruction}`;

const MAX_RETRIES = 3; // Max retry attempts before giving up
const INITIAL_RETRY_DELAY_MS = 10000; // 10 seconds (reduced for faster retries)
const API_TIMEOUT_MS = 60000; // 60 second timeout for Gemini API calls
const MIN_REQUEST_INTERVAL_MS = 15000; // 15 seconds between requests (4 per minute)

let lastRequestTime = 0;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (lastRequestTime > 0 && elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

type ImagePart = { inlineData: { data: string; mimeType: string } };

async function fetchListingImages(
  listing: Listing,
  timestamp: () => string,
): Promise<ImagePart[]> {
  console.log(`[${timestamp()}]   Fetching ${Math.min(listing.imageUrls.length, 4)} images...`);
  const imageParts: ImagePart[] = [];

  for (const url of listing.imageUrls.slice(0, 4)) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`[${timestamp()}]   ⚠ Image fetch failed (${response.status}): ${url.slice(0, 60)}...`);
        continue;
      }
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mimeType = response.headers.get("content-type") || "image/jpeg";
      imageParts.push({ inlineData: { data: base64, mimeType } });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      console.log(`[${timestamp()}]   ⚠ Image fetch error: ${errMsg}`);
    }
  }

  if (imageParts.length === 0) {
    throw new Error("Failed to fetch any images for listing");
  }

  console.log(`[${timestamp()}]   Fetched ${imageParts.length} images successfully`);
  return imageParts;
}

// Phase result types (internal only — merged into Evaluation before returning)
interface IdentificationResult {
  isAuthentic: boolean;
  itemIdentification: string;
  itemIdentificationJapanese: string;
  identificationConfidence: number;
  estimatedEra: string;
  redFlags: string[];
  // Story fields
  hook: string;
  brandStory: string;
  itemStory: string;
  historicalContext: string;
  marketContext: string;
  styleGuide: string;
  storyScore: number;
  storyScoreReasoning: string;
}

interface ValuationResult {
  soldListings: { title: string; price: number | null; url: string | null }[];
  estimatedValue: number | null;
  currentPrice: number;
  margin: number | null;
  priceScore: number;
  confidence: number;
  reasoning: string;
}

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  price?: string;
}

// Vertex AI Search (searchLite endpoint — basic web search, no domain verification needed)
// NOTE: searchLite does not generate AI summaries. We rely on Gemini Phase 2 for valuation.
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || "vintage-searcher";
const VERTEX_ENGINE_ID = process.env.VERTEX_ENGINE_ID;
const VERTEX_API_KEY = process.env.VERTEX_API_KEY;

async function vertexSearch(
  query: string,
  pageSize: number,
  timestamp: () => string,
): Promise<SearchResult[]> {
  const endpoint = `https://discoveryengine.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/global/collections/default_collection/engines/${VERTEX_ENGINE_ID}/servingConfigs/default_search:searchLite?key=${VERTEX_API_KEY}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        pageSize,
        contentSearchSpec: {
          snippetSpec: { returnSnippet: true },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[${timestamp()}]   ⚠ Vertex AI Search error (${response.status}): ${errorText.slice(0, 200)}`);
      return [];
    }

    const data = await response.json() as {
      results?: Array<{
        document?: {
          derivedStructData?: {
            title?: string;
            link?: string;
            snippets?: Array<{ snippet?: string }>;
            pagemap?: { metatags?: Array<Record<string, string>> };
          };
        };
      }>;
    };

    // TODO: eBay doesn't expose prices in metatags (product:price:amount / og:price:amount),
    // so the price field will always be empty for eBay results. Prices are extracted by
    // Gemini Phase 2 visiting URLs via urlContext instead. If we add non-eBay sources that
    // do include price metatags, this extraction will work for those.
    const results: SearchResult[] = (data.results ?? []).map((r) => {
      const doc = r.document?.derivedStructData;
      const price = doc?.pagemap?.metatags?.[0]?.["product:price:amount"]
        || doc?.pagemap?.metatags?.[0]?.["og:price:amount"];
      return {
        title: doc?.title ?? "",
        link: doc?.link ?? "",
        snippet: doc?.snippets?.[0]?.snippet ?? "",
        ...(price ? { price } : {}),
      };
    }).filter((r) => r.link);

    console.log(`[${timestamp()}]   Vertex AI Search: Found ${results.length} results`);
    return results;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.log(`[${timestamp()}]   ⚠ Vertex AI Search error: ${errMsg}`);
    return [];
  }
}

async function searchForComps(
  identification: IdentificationResult,
  timestamp: () => string,
): Promise<{ englishSoldResults: SearchResult[]; englishActiveResults: SearchResult[]; japaneseSoldResults: SearchResult[]; japaneseActiveResults: SearchResult[] }> {
  if (!VERTEX_ENGINE_ID || !VERTEX_API_KEY) {
    console.log(`[${timestamp()}]   ⚠ Vertex AI Search not configured (missing VERTEX_ENGINE_ID or VERTEX_API_KEY)`);
    return { englishSoldResults: [], englishActiveResults: [], japaneseSoldResults: [], japaneseActiveResults: [] };
  }

  const englishSoldQuery = `${identification.itemIdentification} sold`;
  const englishActiveQuery = identification.itemIdentification;
  const japaneseSoldQuery = `${identification.itemIdentificationJapanese} 落札`;
  const japaneseActiveQuery = identification.itemIdentificationJapanese;

  console.log(`[${timestamp()}]   Vertex AI Search: EN sold "${englishSoldQuery}" | EN active "${englishActiveQuery}" | JP sold "${japaneseSoldQuery}" | JP active "${japaneseActiveQuery}"`);

  const [englishSoldResults, englishActiveResults, japaneseSoldResults, japaneseActiveResults] = await Promise.all([
    vertexSearch(englishSoldQuery, 1, timestamp),
    vertexSearch(englishActiveQuery, 2, timestamp),
    vertexSearch(japaneseSoldQuery, 2, timestamp),
    vertexSearch(japaneseActiveQuery, 4, timestamp),
  ]);

  console.log(`[${timestamp()}]   Vertex AI Search: ${englishSoldResults.length} EN sold + ${englishActiveResults.length} EN active + ${japaneseSoldResults.length} JP sold + ${japaneseActiveResults.length} JP active`);
  return { englishSoldResults, englishActiveResults, japaneseSoldResults, japaneseActiveResults };
}

const STORY_LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  zh: "Write ALL story fields (hook, brandStory, itemStory, historicalContext, marketContext, storyScoreReasoning) in Traditional Chinese (繁體中文). Keep the tone casual, cool, and insider — like a GQ editor texting a friend who collects vintage. Short punchy sentences.",
};

function buildIdentificationPrompt(listing: Listing, lang?: string, promptAppend?: string): string {
  const langInstruction = STORY_LANGUAGE_INSTRUCTIONS[lang ?? ""] ?? "";
  const append = [langInstruction, promptAppend].filter(Boolean).join("\n\n");
  return IDENTIFICATION_PROMPT
    .replace("{title}", listing.title)
    .replace("{price}", listing.price.toString())
    .replace("{description}", listing.description)
    .replace("{storyLanguageInstruction}", append);
}

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  zh: "Write the reasoning field in Traditional Chinese (繁體中文).",
};

function buildValuationPrompt(
  listing: Listing,
  identification: IdentificationResult,
  englishSoldResults: SearchResult[],
  englishActiveResults: SearchResult[],
  japaneseSoldResults: SearchResult[],
  japaneseActiveResults: SearchResult[],
  lang?: string,
): string {
  const formatResults = (results: SearchResult[], offset = 0) =>
    results.map((r, i) => {
      let entry = `${offset + i + 1}. "${r.title}"`;
      if (r.price) entry += ` - $${r.price}`;
      entry += `\n   ${r.link}`;
      entry += `\n   Snippet: "${r.snippet}"`;
      return entry;
    }).join("\n\n");

  let formattedResults = "(No comparable listings found from web search)";
  const allResults = [...englishSoldResults, ...englishActiveResults, ...japaneseSoldResults, ...japaneseActiveResults];
  if (allResults.length > 0) {
    const parts: string[] = [];
    let offset = 0;
    if (englishSoldResults.length > 0) {
      parts.push(`English sold comps (visit URLs for pricing):\n${formatResults(englishSoldResults, offset)}`);
      offset += englishSoldResults.length;
    }
    if (englishActiveResults.length > 0) {
      parts.push(`English active listings (visit URLs for pricing):\n${formatResults(englishActiveResults, offset)}`);
      offset += englishActiveResults.length;
    }
    if (japaneseSoldResults.length > 0) {
      parts.push(`Japanese sold listings 落札 (prices in JPY — convert at ~150 JPY/USD):\n${formatResults(japaneseSoldResults, offset)}`);
      offset += japaneseSoldResults.length;
    }
    if (japaneseActiveResults.length > 0) {
      parts.push(`Japanese active listings (prices in JPY — convert at ~150 JPY/USD):\n${formatResults(japaneseActiveResults, offset)}`);
    }
    formattedResults = parts.join("\n\n");
  }

  return VALUATION_PROMPT
    .replace("{itemIdentification}", identification.itemIdentification)
    .replace("{estimatedEra}", identification.estimatedEra || "Unknown")
    .replace("{identificationConfidence}", identification.identificationConfidence.toFixed(2))
    .replace("{redFlags}", identification.redFlags.length > 0 ? identification.redFlags.join(", ") : "None")
    .replace("{title}", listing.title)
    .replace("{price}", listing.price.toString())
    .replace("{searchResults}", formattedResults)
    .replace("{languageInstruction}", LANGUAGE_INSTRUCTIONS[lang ?? ""] ?? "");
}

async function resolveRedirectUrl(url: string): Promise<string> {
  try {
    // Don't follow redirects — read the Location header to get the actual source URL
    const response = await fetch(url, { method: "GET", redirect: "manual" });
    const location = response.headers.get("location");
    return location || url;
  } catch {
    return url;
  }
}

async function extractGroundingReferences(response: GenerateContentResponse): Promise<string[]> {
  // Gemini returns a single candidate by default, and only 1 is supported when tools are enabled
  const metadata = response.candidates?.[0]?.groundingMetadata;
  if (!metadata?.groundingChunks) return [];

  const refs = await Promise.all(
    metadata.groundingChunks
      .filter((chunk) => chunk.web?.uri)
      .map(async (chunk) => {
        return await resolveRedirectUrl(chunk.web!.uri!);
      }),
  );
  return refs;
}

interface CallGeminiConfig<T> {
  prompt: string;
  imageParts: ImagePart[];
  schema: Record<string, unknown>;
  tools: Record<string, unknown>[];
  timestamp: () => string;
  phaseLabel: string;
}

async function callGemini<T>(config: CallGeminiConfig<T>): Promise<{ result: T; references: string[] }> {
  const { prompt, imageParts, schema, tools, timestamp, phaseLabel } = config;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`[${timestamp()}]   ${phaseLabel}: Calling Gemini API${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}...`);
      await throttle();
      const startTime = Date.now();
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }, ...imageParts],
          },
        ],
        config: {
          ...(tools.length > 0 ? { tools } : {}),
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        },
      });
      const elapsed = Date.now() - startTime;

      const text = response.text ?? "";
      if (!text) {
        console.log(`[${timestamp()}]   ✗ ${phaseLabel}: Empty response from Gemini (${elapsed}ms)`);
        throw new Error(`${phaseLabel}: Empty response from Gemini`);
      }

      const result = JSON.parse(text) as T;

      const references = await extractGroundingReferences(response);

      console.log(`[${timestamp()}]   ✓ ${phaseLabel}: Completed in ${elapsed}ms`);

      return { result, references };
    } catch (error: unknown) {
      lastError = error as Error;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Retry on rate limit (429), network errors, or timeouts
      const isRetryable = errorMsg.includes("429") ||
        errorMsg.includes("fetch failed") ||
        errorMsg.includes("ECONNRESET") ||
        errorMsg.includes("ETIMEDOUT") ||
        errorMsg.includes("abort") ||
        errorMsg.includes("Abort");

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        const reason = errorMsg.includes("429") ? "Rate limited" : "Network error";
        console.log(`[${timestamp()}]   ⚠ ${phaseLabel}: ${reason}: ${errorMsg.slice(0, 100)}`);
        console.log(`[${timestamp()}]   Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }

      // Extra logging for INVALID_ARGUMENT to help diagnose root cause
      if (errorMsg.includes("INVALID_ARGUMENT") || errorMsg.includes("400")) {
        console.error(`[${timestamp()}]   ✗ ${phaseLabel} INVALID_ARGUMENT — prompt length: ${prompt.length} chars, images: ${imageParts.length}, tools: ${JSON.stringify(tools)}`);
        console.error(`[${timestamp()}]   ✗ ${phaseLabel} prompt preview (last 500 chars):`, prompt.slice(-500));
      }

      // Log full error details before throwing
      console.error(`[${timestamp()}]   ✗ ${phaseLabel} Error:`, error);
      throw error;
    }
  }

  // If we exhausted retries, throw the last error
  console.log(`[${timestamp()}]   ✗ ${phaseLabel}: Max retries exceeded`);
  throw lastError || new Error(`${phaseLabel}: Max retries exceeded`);
}

const IDENTIFICATION_SCHEMA = {
  type: "object",
  properties: {
    isAuthentic: { type: "boolean" },
    itemIdentification: { type: "string" },
    itemIdentificationJapanese: { type: "string" },
    identificationConfidence: { type: "number" },
    estimatedEra: { type: "string" },
    redFlags: { type: "array", items: { type: "string" } },
    hook: { type: "string" },
    brandStory: { type: "string" },
    itemStory: { type: "string" },
    historicalContext: { type: "string" },
    marketContext: { type: "string" },
    styleGuide: { type: "string" },
    storyScore: { type: "number" },
    storyScoreReasoning: { type: "string" },
  },
  required: [
    "isAuthentic", "itemIdentification", "itemIdentificationJapanese",
    "identificationConfidence", "estimatedEra", "redFlags",
    "hook", "brandStory", "itemStory", "historicalContext", "marketContext",
    "styleGuide", "storyScore", "storyScoreReasoning",
  ],
};

const VALUATION_SCHEMA = {
  type: "object",
  properties: {
    soldListings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          price: { type: "number" },
          url: { type: "string" },
        },
        required: ["title"],
      },
    },
    estimatedValue: { type: "number" },
    currentPrice: { type: "number" },
    margin: { type: "number" },
    priceScore: { type: "number" },
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
  required: ["soldListings", "currentPrice", "priceScore", "confidence", "reasoning"],
};

export async function runIdentification(listing: Listing, lang?: string, promptAppend?: string): Promise<IdentificationResult> {
  const timestamp = () => new Date().toISOString();
  const imageParts = await fetchListingImages(listing, timestamp);
  const identificationPrompt = buildIdentificationPrompt(listing, lang, promptAppend);
  const { result: identification } = await callGemini<IdentificationResult>({
    prompt: identificationPrompt,
    imageParts,
    schema: IDENTIFICATION_SCHEMA,
    tools: [{ googleSearch: {} }],
    timestamp,
    phaseLabel: `Phase 1: Identification (${lang ?? "en"})`,
  });
  console.log(`[${timestamp()}]   Identified as: ${identification.itemIdentification} (${(identification.identificationConfidence * 100).toFixed(0)}% confidence)`);
  return identification;
}

export async function evaluateListing(listing: Listing, lang?: string, promptAppend?: string): Promise<Evaluation> {
  if (USE_MOCK_DATA) return getMockEvaluation(listing);
  const timestamp = () => new Date().toISOString();
  console.log(`[${timestamp()}] Evaluating: ${listing.title.slice(0, 50)}...`);

  const imageParts = await fetchListingImages(listing, timestamp);

  // Phase 1: Identification (with images + Google Search for verification)
  const identificationPrompt = buildIdentificationPrompt(listing, lang, promptAppend);
  const { result: identification, references: refs1 } = await callGemini<IdentificationResult>({
    prompt: identificationPrompt,
    imageParts,
    schema: IDENTIFICATION_SCHEMA,
    tools: [{ googleSearch: {} }],
    timestamp,
    phaseLabel: "Phase 1: Identification",
  });

  console.log(`[${timestamp()}]   Identified as: ${identification.itemIdentification} (${(identification.identificationConfidence * 100).toFixed(0)}% confidence)`);

  // Google Custom Search: find comparable listings
  const { englishSoldResults, englishActiveResults, japaneseSoldResults, japaneseActiveResults } = await searchForComps(identification, timestamp);

  // Log search results for debugging
  console.log(`[${timestamp()}]   Search results for "${identification.itemIdentification}":`);
  [...englishSoldResults, ...englishActiveResults, ...japaneseSoldResults, ...japaneseActiveResults].forEach((r, i) => console.log(`[${timestamp()}]     ${i + 1}. ${r.title} — ${r.link}${r.price ? ` ($${r.price})` : ""}`));

  // Phase 2: Valuation (Gemini visits English URLs via urlContext; Japanese results passed as text only)
  const valuationPrompt = buildValuationPrompt(listing, identification, englishSoldResults, englishActiveResults, japaneseSoldResults, japaneseActiveResults, lang);
  const { result: valuation, references: refs2 } = await callGemini<ValuationResult>({
    prompt: valuationPrompt,
    imageParts,
    schema: VALUATION_SCHEMA,
    tools: [{ urlContext: {} }],
    timestamp,
    phaseLabel: "Phase 2: Valuation",
  });

  // Log soldListings returned by Phase 2
  console.log(`[${timestamp()}]   soldListings (${valuation.soldListings?.length ?? 0}):`);
  (valuation.soldListings ?? []).forEach((s, i) => console.log(`[${timestamp()}]     ${i + 1}. ${s.title} — ${s.price != null ? `$${s.price}` : "N/A"}${s.url ? ` — ${s.url}` : ""}`));

  // Merge into single Evaluation
  const evaluation: Evaluation = {
    isAuthentic: identification.isAuthentic,
    itemIdentification: identification.itemIdentification,
    identificationConfidence: identification.identificationConfidence,
    estimatedEra: identification.estimatedEra,
    redFlags: identification.redFlags,
    soldListings: valuation.soldListings ?? [],
    estimatedValue: (valuation.soldListings?.length ?? 0) > 0 ? (valuation.estimatedValue ?? null) : listing.price,
    currentPrice: valuation.currentPrice,
    margin: (valuation.soldListings?.length ?? 0) > 0 ? (valuation.margin ?? null) : 0,
    priceScore: (valuation.soldListings?.length ?? 0) > 0 ? (valuation.priceScore ?? 0) : 0,
    confidence: valuation.confidence,
    reasoning: valuation.reasoning,
    references: [...refs1, ...refs2],
    hook: identification.hook,
    brandStory: identification.brandStory,
    itemStory: identification.itemStory,
    historicalContext: identification.historicalContext,
    marketContext: identification.marketContext,
    styleGuide: identification.styleGuide,
    storyScore: identification.storyScore,
    storyScoreReasoning: identification.storyScoreReasoning,
  };

  console.log(`[${timestamp()}]   ✓ Final: Era: ${evaluation.estimatedEra}, Story: ${(evaluation.storyScore * 100).toFixed(0)}%, Margin: $${evaluation.margin ?? "N/A"}, Confidence: ${(evaluation.confidence * 100).toFixed(0)}%`);

  return evaluation;
}

type StorySnapshot = {
  itemIdentification: string;
  styleGuide: string;
  hook: string;
  marketContext: string;
};

// Scores a batch of candidate items against a user's liked stories in a single cheap model call.
// Returns a map of index → personalFavorScore (0-1). Returns empty map if no liked stories.
export async function computePersonalScores(
  candidates: StorySnapshot[],
  likedStories: StorySnapshot[],
): Promise<Record<number, number>> {
  if (likedStories.length === 0 || candidates.length === 0) return {};

  const likedSummary = likedStories.slice(0, 15).map((s, i) =>
    `${i + 1}. ${s.itemIdentification} — ${s.styleGuide}`
  ).join("\n");

  const candidateList = candidates.map((c, i) =>
    `${i + 1}. ${c.itemIdentification} — ${c.styleGuide} | ${c.hook}`
  ).join("\n");

  const prompt = `You are scoring aesthetic and style compatibility for a vintage clothing enthusiast.

The user has liked these items (their taste profile):
${likedSummary}

Score each candidate item (0–1) based on how well it matches this person's aesthetic:
- 0.9–1.0: Near-identical aesthetic, era, and culture to their liked items
- 0.7–0.9: Strong overlap in taste
- 0.4–0.7: Some overlap but different vibe
- 0.0–0.4: Different aesthetic entirely

Candidates:
${candidateList}

Return scores as a JSON array in the same order as the candidates.`;

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.0-flash-lite",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            scores: { type: "array", items: { type: "number" } },
          },
          required: ["scores"],
        },
      },
    });

    const result = JSON.parse(response.text ?? "{}") as { scores?: number[] };
    const scores: Record<number, number> = {};
    (result.scores ?? []).forEach((s, i) => {
      scores[i] = Math.min(1, Math.max(0, s));
    });
    return scores;
  } catch (error) {
    console.error("Personal score computation failed:", error instanceof Error ? error.message : error);
    return {};
  }
}

const MOCK_STORY_DEFAULTS = {
  hook: "American mills stopped making them like this fifty years ago. That's the whole story.",
  brandStory: "Founded when clothing was considered an investment, not a disposable good. Workers wore this brand because it lasted — not because it was marketed to them.",
  itemStory: "The construction details are doing all the talking here. The stitching, the hardware, the label — everything points to an era when quality wasn't a premium tier, it was the baseline.",
  historicalContext: "Post-war American manufacturing at its absolute peak. The garment industry was producing things that nobody expected to still exist seventy years later.",
  marketContext: "Solid piece with a growing collector base. Not a grail, but the kind of thing that moves fast when it's priced right. Real heads know.",
  styleGuide: "Fits into a workwear or Americana wardrobe without effort. Wear it over a plain white tee with straight-leg denim. The person who pulls this off dresses intentionally but doesn't overthink it.",
  storyScore: 0.72,
  storyScoreReasoning: "Solid vintage piece with authenticating details, good narrative potential.",
};

// Mock evaluations based on listing URL (matches mock listings in ecommerce.ts)
function getMockEvaluation(listing: Listing): Evaluation {
  const mockEvaluations: Record<string, Evaluation> = {
    "https://www.ebay.com/itm/123456789001": {
      isAuthentic: true,
      itemIdentification: "Pendleton Board Shirt, loop collar, wool flannel, Made in USA",
      identificationConfidence: 0.9,
      estimatedEra: "1960s",
      estimatedValue: 120,
      currentPrice: 45,
      margin: 75,
      confidence: 0.85,
      reasoning: "Pendleton board shirts with loop collars are highly collectible.",
      redFlags: ["Condition not fully visible in photos"],
      references: ["Similar Pendleton loop collar sold for $135 on eBay 2024"],
      soldListings: [
        { title: "Pendleton loop collar board shirt sz M", price: 135, url: null },
        { title: "Pendleton wool board shirt 1960s blue plaid", price: 110, url: null },
      ],
      hook: "The loop collar disappeared from Pendleton's lineup in 1963. This one has it.",
      brandStory: "Pendleton Woolen Mills, 1909, Pendleton Oregon. Started weaving blankets for Native American trade, ended up dressing surfers in Malibu and executives in Portland at the same time. That's not a brand strategy — that's just a great shirt.",
      itemStory: "Loop collar is a hard authentication marker — Pendleton cut it after the early '60s, full stop. The wool flannel has that dense, slightly scratchy hand that every modern reproduction misses. This is the real thing.",
      historicalContext: "Early '60s America, peak casual. The moment before the counterculture fractured everything — when the same wool shirt worked at a beach bonfire and a Sunday service and nobody thought twice about it.",
      marketContext: "Loop-collar Pendletons are a legitimate grail. Surf collectors want them because of the Malibu connection. Workwear guys want them because of the construction. Ivy heads want them because of the silhouette. Three separate collector bases chasing the same shirt — that's why prices keep moving up. This one is priced like the seller doesn't know what they have.",
      styleGuide: "This is a shirt for someone who dresses in the Ivy or surf-Americana lane. Medium-weight wool flannel — wear it open as an overshirt in fall, buttoned up with cords or raw denim in winter. The plaid reads classic, not costume. Works best on someone who owns at least one pair of well-worn Levi's and doesn't need to explain why.",
      storyScore: 0.88,
      storyScoreReasoning: "Iconic brand at its most collectible era, hard authentication detail in the loop collar, and three distinct collector communities actively chasing this specific variant.",
    },
    "https://www.ebay.com/itm/123456789003": {
      isAuthentic: true,
      itemIdentification: "Levi's 501 Big E, redline selvedge, single stitch, sz 32x30, pre-1971",
      identificationConfidence: 0.95,
      estimatedEra: "1960s",
      estimatedValue: 400,
      currentPrice: 150,
      margin: 250,
      confidence: 0.9,
      reasoning: "Big E Levi's 501s with redline selvedge are highly valuable. Single stitch construction confirms pre-1971 manufacture.",
      redFlags: ["Seller may know value - could be auction bait"],
      references: ["Big E 501s sold for $300-600 on eBay in 2024"],
      soldListings: [
        { title: "Levi's 501 Big E redline selvedge 33x30", price: 450, url: null },
        { title: "Levi's 501 Big E single stitch 1960s 31x32", price: 380, url: null },
      ],
      hook: "Levi's changed the red tab from uppercase to lowercase in 1971. Everything before that date is a different animal entirely.",
      brandStory: "Levi Strauss & Co. patented the riveted pant in 1873. The 501 became a cultural object in the '50s when James Dean wore it on screen. By the '60s it was the uniform — students, workers, musicians, none of them thinking about posterity. They were just getting dressed.",
      itemStory: "Big E red tab. Redline selvedge visible at the outseam. Single-needle stitching throughout. That's the authentication trinity and this pair has all three. The selvedge denim was woven on shuttle looms Levi's retired when they modernized — you literally cannot replicate this fabric with current production methods.",
      historicalContext: "Late '60s San Francisco, union workers, shuttle looms running their last years. The exact moment American manufacturing was about to change forever. These jeans were made at the end of something.",
      marketContext: "This is not a sleeper. Big E 501s with redline selvedge are the most documented, most sought-after piece of American vintage denim — full stop. Japanese collectors have been driving prices for two decades. A clean pair in this size regularly clears $400-600 on Grailed, more in Tokyo. This listing is priced by someone who doesn't know what the red tab means.",
      styleGuide: "High-rise, straight leg, slightly tapered at the ankle — the original silhouette before Levi's started cutting them for mass market. Wear them cuffed with a plain white tee, a loop-collar flannel, or a trucker jacket. This is the foundation piece for a Japanese-influenced Americana wardrobe. The person who buys these knows exactly what they're doing.",
      storyScore: 0.97,
      storyScoreReasoning: "The canonical American garment. Ironclad authentication markers. Global collector demand with a decades-long track record. As close to a perfect vintage find as exists.",
    },
    "https://www.ebay.com/itm/123456789005": {
      isAuthentic: true,
      itemIdentification: "1950s two-tone rayon bowling shirt, chain stitch embroidery 'Joes Auto Shop'",
      identificationConfidence: 0.92,
      estimatedEra: "1950s",
      estimatedValue: 180,
      currentPrice: 35,
      margin: 145,
      confidence: 0.88,
      reasoning: "1950s bowling shirts with chain stitch embroidery are highly collectible.",
      redFlags: [],
      references: ["Chain stitch bowling shirts sold $150-300 on vintage marketplaces"],
      soldListings: [
        { title: "1950s chain stitch bowling shirt two-tone rayon", price: 225, url: null },
        { title: "Vintage 50s bowling shirt embroidered 'Al's Garage'", price: 180, url: null },
      ],
      hook: "Joe's Auto Shop closed decades ago. The shirt survived.",
      brandStory: "Chain stitch bowling shirts were the branded merch before branded merch existed. Regional sportswear houses — King Louie, Swingster, Tri-Mountain — made them by the thousands for bowling leagues, auto shops, diners. Every one was a custom order. Every one is one of a kind.",
      itemStory: "Chain stitch embroidery loops back on itself — structurally different from modern machine embroidery, creates a raised, almost three-dimensional surface you can feel with your thumb. Two-tone rayon: smooth, cool, slightly shiny in a way synthetic fabrics never replicated. The 'Joes Auto Shop' script on the back turns this from a shirt into a primary source.",
      historicalContext: "Bowling was the number one participation sport in 1950s America. The league shirt was the uniform — the garment that put the factory worker and the shop owner in matching fits on a Tuesday night. Pure postwar American egalitarianism, sewn in rayon.",
      marketContext: "Custom chain stitch bowling shirts are a grail for the workwear and Americana crowd — and this one has the rare trifecta: two-tone rayon, chain stitch embroidery, and a named employer on the back. Named shirts command serious premiums. Rockabilly collectors, Japanese vintage buyers, and the Grailed streetwear crowd all want this shirt for different reasons. At $35 it's not even a decision.",
      styleGuide: "Rayon drapes differently than cotton — it moves when you walk, which is the point. Wear it tucked into high-waist trousers or open over a ribbed tank. Two-tone color blocking reads as rockabilly or vintage Americana depending on how you style the rest. This is a statement shirt, not a layer. The person who wears it well has a point of view about how they dress.",
      storyScore: 0.91,
      storyScoreReasoning: "Named custom embroidery on an authenticated chain stitch rayon bowling shirt — the kind of piece that ends up on the Instagram of every serious Americana collector within a week of listing.",
    },
    "https://www.ebay.com/itm/123456789009": {
      isAuthentic: true,
      itemIdentification: "1960s sequin evening gown, ILGWU union label, formal full-length dress",
      identificationConfidence: 0.88,
      estimatedEra: "1960s",
      estimatedValue: 175,
      currentPrice: 48,
      margin: 127,
      confidence: 0.92,
      reasoning: "ILGWU union label definitively dates this to 1960s.",
      redFlags: ["Minor sequin loss mentioned"],
      references: ["60s sequin gowns sell $150-300"],
      soldListings: [
        { title: "1960s ILGWU sequin evening gown full length", price: 195, url: null },
        { title: "Vintage 60s sequin formal dress gold", price: 165, url: null },
      ],
      hook: "The ILGWU label is a small red rectangle. It's also a timestamp, a union card, and the reason this dress is the real thing.",
      brandStory: "The International Ladies' Garment Workers' Union fought for fair wages and safe conditions from 1900 until their merger in 1995. Their label — sewn into millions of American-made garments — became the authentication marker nobody talks about enough. If it has the ILGWU tag, it was made here, by skilled workers, before the industry left.",
      itemStory: "Hand-applied sequin work, dense and heavy in the way early '60s formal wear was. Modern sequined pieces use iron-on or machine techniques — the weight alone tells you this is different. Silhouette is early-to-mid '60s: fitted waist, floor-length, the kind of construction that took a real seamstress two days to execute.",
      historicalContext: "Early '60s America, last golden era of domestic formal wear. Before synthetics took over. Before everything moved offshore. When getting dressed for the evening meant putting on something that was actually made for you.",
      marketContext: "ILGWU-labeled eveningwear is having a serious moment with vintage fashion collectors who care about provenance and labor history — which is increasingly everyone who matters in that space. This specific combination (union label, hand-sequin, '60s silhouette) moves fast on Vestiaire and 1stDibs when priced right. At $48 this is dramatically under what it should be.",
      styleGuide: "Early '60s silhouette — fitted through the waist, floor-length, structured enough to hold its shape without a lot of undergarment architecture. The sequins make it an event piece, not an everyday wear. This is for someone who dresses for evenings with intention: gallery openings, dinner parties, occasions that warrant actual glamour. Pairs with minimal jewelry — the dress is doing the work.",
      storyScore: 0.85,
      storyScoreReasoning: "ILGWU authentication gives this dress documentary weight beyond fashion — it sits at the intersection of labor history and collectible formal wear, which is a collector sweet spot right now.",
    },
  };

  const mockStory = MOCK_STORY_DEFAULTS;
  const evaluation = mockEvaluations[listing.url];
  if (evaluation) {
    console.log(`[MOCK] Evaluated: ${listing.title.slice(0, 50)}...`);
    return evaluation;
  }

  return {
    isAuthentic: false,
    itemIdentification: "Unknown item",
    identificationConfidence: 0.1,
    estimatedEra: "Unknown",
    estimatedValue: listing.price,
    currentPrice: listing.price,
    margin: 0,
    confidence: 0.3,
    reasoning: "Unable to determine authenticity or value from available information.",
    redFlags: ["Insufficient data for evaluation"],
    references: [],
    soldListings: [],
    ...mockStory,
  };
}
