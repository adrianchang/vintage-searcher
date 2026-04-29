import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import type { Listing, Evaluation } from "../types";


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
      const rawMime = response.headers.get("content-type") || "image/jpeg";
      const mimeType = rawMime.split(";")[0].trim();
      if (!mimeType.startsWith("image/")) {
        console.log(`[${timestamp()}]   ⚠ Skipping non-image content-type (${mimeType}): ${url.slice(0, 60)}`);
        continue;
      }
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
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

export interface IdentificationResult {
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

export type ValuationOutput = ValuationResult & { references: string[] };

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
  imageParts?: ImagePart[];
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
            parts: imageParts ? [{ text: prompt }, ...imageParts] : [{ text: prompt }],
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
        console.error(`[${timestamp()}]   ✗ ${phaseLabel} INVALID_ARGUMENT — prompt length: ${prompt.length} chars, images: ${(imageParts ?? []).length}, tools: ${JSON.stringify(tools)}`);
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

export async function runValuation(
  listing: Listing,
  identification: IdentificationResult,
  lang?: string,
): Promise<ValuationOutput> {
  const timestamp = () => new Date().toISOString();
  // Images omitted — condition context comes from redFlags in the prompt.
  // Adding imageParts here may improve condition-based valuation but risks INVALID_ARGUMENT with urlContext.

  const { englishSoldResults, englishActiveResults, japaneseSoldResults, japaneseActiveResults } =
    await searchForComps(identification, timestamp);

  console.log(`[${timestamp()}]   Search results for "${identification.itemIdentification}":`);
  [...englishSoldResults, ...englishActiveResults, ...japaneseSoldResults, ...japaneseActiveResults]
    .forEach((r, i) => console.log(`[${timestamp()}]     ${i + 1}. ${r.title} — ${r.link}${r.price ? ` ($${r.price})` : ""}`));

  const valuationPrompt = buildValuationPrompt(
    listing, identification,
    englishSoldResults, englishActiveResults,
    japaneseSoldResults, japaneseActiveResults,
    lang,
  );

  const { result: valuation, references } = await callGemini<ValuationResult>({
    prompt: valuationPrompt,
    schema: VALUATION_SCHEMA,
    tools: [{ urlContext: {} }],
    timestamp,
    phaseLabel: "Phase 2: Valuation",
  });

  console.log(`[${timestamp()}]   soldListings (${valuation.soldListings?.length ?? 0}):`);
  (valuation.soldListings ?? []).forEach((s, i) =>
    console.log(`[${timestamp()}]     ${i + 1}. ${s.title} — ${s.price != null ? `$${s.price}` : "N/A"}${s.url ? ` — ${s.url}` : ""}`)
  );

  return { ...valuation, references };
}

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


type StorySnapshot = {
  itemIdentification: string;
  styleGuide: string;
  hook: string;
  marketContext: string;
};

async function batchScoreAgainstStories(
  candidates: StorySnapshot[],
  referenceStories: StorySnapshot[],
  promptInstruction: string,
): Promise<Record<number, number>> {
  if (referenceStories.length === 0 || candidates.length === 0) return {};

  const referenceSummary = referenceStories.slice(0, 15).map((s, i) =>
    `${i + 1}. ${s.itemIdentification} — ${s.styleGuide}`
  ).join("\n");

  const candidateList = candidates.map((c, i) =>
    `${i + 1}. ${c.itemIdentification} — ${c.styleGuide} | ${c.hook}`
  ).join("\n");

  const prompt = `You are scoring aesthetic and style similarity for a vintage clothing enthusiast.

${promptInstruction}
${referenceSummary}

Candidates to score:
${candidateList}

Return scores as a JSON array in the same order as the candidates.`;

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash-lite",
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
    console.error("Batch score computation failed:", error instanceof Error ? error.message : error);
    return {};
  }
}

// Scores candidates against liked stories (0=no match, 1=perfect match).
export async function computePersonalScores(
  candidates: StorySnapshot[],
  likedStories: StorySnapshot[],
): Promise<Record<number, number>> {
  return batchScoreAgainstStories(
    candidates,
    likedStories,
    `The user has liked these items (their taste profile). Score each candidate 0–1 on how well it matches this person's aesthetic:
- 0.9–1.0: Near-identical aesthetic, era, and culture to their liked items
- 0.7–0.9: Strong overlap in taste
- 0.4–0.7: Some overlap but different vibe
- 0.0–0.4: Different aesthetic entirely

Liked items:`,
  );
}

// Scores candidates against disliked stories (0=nothing in common, 1=very similar to disliked items).
// This score is used as a penalty: finalScore = baseScore × (1 - dislikeSimilarity).
export async function computeDislikeScores(
  candidates: StorySnapshot[],
  dislikedStories: StorySnapshot[],
): Promise<Record<number, number>> {
  return batchScoreAgainstStories(
    candidates,
    dislikedStories,
    `The user has disliked these items. Score each candidate 0–1 on how similar it is to what this person dislikes:
- 0.9–1.0: Very similar aesthetic, era, and culture to their disliked items
- 0.7–0.9: Strong overlap with what they dislike
- 0.4–0.7: Some overlap but different enough
- 0.0–0.4: Clearly different from what they dislike

Disliked items:`,
  );
}

