import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import type { Listing, Evaluation } from "../types";

// Set to true to use mock evaluations for testing
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === "true";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "not-set" });

const IDENTIFICATION_PROMPT = `You are a veteran vintage clothing collector evaluating an eBay listing. You MUST use Google Search to verify brand/model/era details.

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
Set identificationConfidence (0-1): how sure are you about WHAT this item is? High if tags/labels are clear and construction details match. Low if you're guessing based on limited photos.`;

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

Then produce your valuation:
- Set estimatedValue based on the prices you found
- Calculate margin (estimatedValue - currentPrice)
- Set confidence (0-1): high if you found strong, similar comps. Low if comps are weak or dissimilar.

IMPORTANT: estimatedValue MUST come from the comps above, not guesses. If none of the URLs are useful, set confidence LOW.

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
}

interface ValuationResult {
  soldListings: { title: string; price: number | null; url: string | null }[];
  estimatedValue: number | null;
  currentPrice: number;
  margin: number | null;
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

function buildIdentificationPrompt(listing: Listing): string {
  return IDENTIFICATION_PROMPT
    .replace("{title}", listing.title)
    .replace("{price}", listing.price.toString())
    .replace("{description}", listing.description);
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
  },
  required: ["isAuthentic", "itemIdentification", "itemIdentificationJapanese", "identificationConfidence", "estimatedEra", "redFlags"],
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
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
  required: ["soldListings", "currentPrice", "confidence", "reasoning"],
};

export async function evaluateListing(listing: Listing, lang?: string): Promise<Evaluation> {
  if (USE_MOCK_DATA) return getMockEvaluation(listing);
  const timestamp = () => new Date().toISOString();
  console.log(`[${timestamp()}] Evaluating: ${listing.title.slice(0, 50)}...`);

  const imageParts = await fetchListingImages(listing, timestamp);

  // Phase 1: Identification (with images + Google Search for verification)
  const identificationPrompt = buildIdentificationPrompt(listing);
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
    estimatedValue: valuation.estimatedValue ?? null,
    currentPrice: valuation.currentPrice,
    margin: valuation.margin ?? null,
    confidence: valuation.confidence,
    reasoning: valuation.reasoning,
    references: [...refs1, ...refs2],
  };

  console.log(`[${timestamp()}]   ✓ Final: Era: ${evaluation.estimatedEra}, Margin: $${evaluation.margin ?? "N/A"}, Confidence: ${(evaluation.confidence * 100).toFixed(0)}%`);

  return evaluation;
}

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
      reasoning: "Pendleton board shirts with loop collars are highly collectible. The loop collar indicates pre-1960s manufacture. Made in USA Pendleton wool shirts from this era typically sell for $100-150.",
      redFlags: ["Condition not fully visible in photos"],
      references: ["Similar Pendleton loop collar sold for $135 on eBay 2024", "Vintage Pendleton price guide"],
      soldListings: [
        { title: "Pendleton loop collar board shirt sz M", price: 135, url: null },
        { title: "Pendleton wool board shirt 1960s blue plaid", price: 110, url: null },
      ],
    },
    "https://www.ebay.com/itm/123456789002": {
      isAuthentic: true,
      itemIdentification: "Mixed lot of women's dresses, likely 1950s-1960s, brands unverifiable from photos",
      identificationConfidence: 0.35,
      estimatedEra: "1950s-1960s",
      estimatedValue: 200,
      currentPrice: 89,
      margin: 111,
      confidence: 0.6,
      reasoning: "Estate sale lots often contain hidden gems. The description mentions 50s/60s dresses. If even 2-3 pieces are authentic vintage in good condition, the lot could be worth significantly more.",
      redFlags: ["Mixed lot - quality varies", "Cannot verify individual pieces", "As-is condition"],
      references: ["Vintage dress lots typically yield 2-3x return for experienced resellers"],
      soldListings: [
        { title: "Lot of 5 1950s vintage dresses mixed sizes", price: 175, url: null },
      ],
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
      reasoning: "Big E Levi's 501s with redline selvedge are highly valuable. The single stitch construction confirms pre-1971 manufacture. Size 32x30 is desirable. Seller appears knowledgeable but price is still below market.",
      redFlags: ["Seller may know value - could be auction bait"],
      references: ["Big E 501s sold for $300-600 on eBay in 2024", "Levi's vintage dating guide confirms Big E = pre-1971"],
      soldListings: [
        { title: "Levi's 501 Big E redline selvedge 33x30", price: 450, url: null },
        { title: "Levi's 501 Big E single stitch 1960s 31x32", price: 380, url: null },
        { title: "Vintage Levi's 501 Big E selvedge denim", price: 520, url: null },
      ],
    },
    "https://www.ebay.com/itm/123456789004": {
      isAuthentic: true,
      itemIdentification: "Unknown brand wool overcoat, possibly 1950s, no visible labels",
      identificationConfidence: 0.3,
      estimatedEra: "1950s",
      estimatedValue: 85,
      currentPrice: 25,
      margin: 60,
      confidence: 0.5,
      reasoning: "Description suggests casual seller clearing estate. 'Grandmas coat' language indicates potential true vintage. Wool coats from 1950s can be valuable if from quality makers.",
      redFlags: ["Moth holes mentioned", "No label visible", "Only one photo", "Low confidence without more details"],
      references: ["1950s wool coats range $50-200 depending on maker and condition"],
      soldListings: [],
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
      reasoning: "1950s bowling shirts with chain stitch embroidery are highly collectible. The two-tone design and custom embroidery ('Joes Auto Shop') add significant value. This is a prime example of underpriced vintage.",
      redFlags: [],
      references: ["Chain stitch bowling shirts sold $150-300 on vintage marketplaces", "Rockabilly collectors pay premium for authentic 50s pieces"],
      soldListings: [
        { title: "1950s chain stitch bowling shirt two-tone rayon", price: 225, url: null },
        { title: "Vintage 50s bowling shirt embroidered 'Al's Garage'", price: 180, url: null },
      ],
    },
    "https://www.ebay.com/itm/123456789007": {
      isAuthentic: true,
      itemIdentification: "Landlubber high-waist bell bottom jeans, deadstock with original tags, sz 26",
      identificationConfidence: 0.88,
      estimatedEra: "1970s",
      estimatedValue: 150,
      currentPrice: 55,
      margin: 95,
      confidence: 0.82,
      reasoning: "Deadstock 1970s Landlubber jeans are collectible. High waist bell bottoms are currently trending. Original tags add significant value. Size 26 waist is desirable for the vintage market.",
      redFlags: ["Verify deadstock claim - check for storage wear"],
      references: ["Deadstock 70s jeans typically sell $100-200", "Landlubber was popular 70s brand"],
      soldListings: [
        { title: "Landlubber bell bottom jeans 1970s deadstock sz 28", price: 160, url: null },
      ],
    },
    "https://www.ebay.com/itm/123456789008": {
      isAuthentic: true,
      itemIdentification: "Unbranded blanket-lined denim chore coat, workwear, heavily worn",
      identificationConfidence: 0.5,
      estimatedEra: "1960s-1970s",
      estimatedValue: 120,
      currentPrice: 40,
      margin: 80,
      confidence: 0.7,
      reasoning: "Blanket-lined denim chore coats are sought after in workwear market. 'Well worn with character' is desirable for this aesthetic. No brand tag suggests possible vintage work coat.",
      redFlags: ["No brand identification", "Heavy wear may limit value"],
      references: ["Vintage chore coats sell $80-200 depending on condition and brand"],
      soldListings: [
        { title: "Vintage blanket-lined denim chore coat workwear", price: 130, url: null },
      ],
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
      reasoning: "ILGWU union label definitively dates this to 1960s. Sequin evening gowns from this era are highly collectible. The label provides authentication that most sellers overlook.",
      redFlags: ["Minor sequin loss mentioned"],
      references: ["ILGWU labels date pieces to 1900-1995, style suggests 1960s", "60s sequin gowns sell $150-300"],
      soldListings: [
        { title: "1960s ILGWU sequin evening gown full length", price: 195, url: null },
        { title: "Vintage 60s sequin formal dress gold", price: 165, url: null },
      ],
    },
    "https://www.ebay.com/itm/123456789010": {
      isAuthentic: true,
      itemIdentification: "Carhartt Detroit Jacket, Made in USA, blanket-lined, 1990s production",
      identificationConfidence: 0.85,
      estimatedEra: "1990s",
      estimatedValue: 95,
      currentPrice: 75,
      margin: 20,
      confidence: 0.75,
      reasoning: "Made in USA Carhartt Detroit jackets are collectible but this appears to be 1990s production rather than true vintage. Still has value but margin is slim.",
      redFlags: ["Likely 1990s not pre-1980s", "Common item - many available"],
      references: ["90s Carhartt Detroit jackets sell $80-120"],
      soldListings: [
        { title: "Carhartt Detroit jacket Made in USA blanket lined", price: 95, url: null },
      ],
    },
  };

  const evaluation = mockEvaluations[listing.url];
  if (evaluation) {
    console.log(`[MOCK] Evaluated: ${listing.title.slice(0, 50)}...`);
    return evaluation;
  }

  // Default evaluation for unknown listings
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
  };
}
