import { GoogleGenAI, Type, type GenerateContentResponse } from "@google/genai";
import type { Listing, Evaluation } from "../types";

// Set to true to use mock evaluations for testing
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === "true";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
Based on your visual inspection, record your identification in itemIdentification. Be specific:
- Brand + model/style (e.g. "Levi's Type III Trucker Jacket, 70505-0217")
- Estimated era of manufacture
- Key authenticating details you observed
Note where the listing description differs from what you see.
Set identificationConfidence (0-1): how sure are you about WHAT this item is? High if tags/labels are clear and construction details match. Low if you're guessing based on limited photos.`;

const VALUATION_PROMPT = `You are a veteran vintage clothing collector researching comparable sales for a specific item. You MUST use Google Search — never skip searching.

ITEM IDENTIFIED IN PREVIOUS ANALYSIS:
- Identification: {itemIdentification}
- Estimated Era: {estimatedEra}
- Identification Confidence: {identificationConfidence}
- Red Flags: {redFlags}

Original Listing:
- Title: {title}
- Listed Price: ${"{price}"}

STEP 1 — COMPARABLE SALES RESEARCH (REQUIRED — search for each)
Search for comparable SOLD items to establish market value. Use these search terms:
- eBay sold: "{searchTerms} sold vintage"
- Japanese markets: "mercari {searchTerms}" (Japanese vintage market often has strong comps)
- Price guides: "{searchTerms} vintage value guide"

For EACH comparable sold item you find, add it to the soldListings array with:
- title: description of the sold item (e.g. "Levi's 501 Big E redline selvedge 32x30")
- price: the sold price in USD (null if unknown)
- url: the listing URL if available (null otherwise)

If you cannot find truly similar sold items, leave soldListings empty, state this in reasoning, and set confidence LOW.

STEP 2 — VALUATION
Based on comparable sales found:
- Set estimatedValue based on actual sold prices you found
- Cite which items from soldListings support your estimatedValue
- If comps are weak or not truly similar, be conservative and note it
- Calculate margin (estimatedValue - currentPrice)
- Set confidence (0-1): how confident are you in the VALUATION? High if you found strong, truly similar comps. Low if comps are weak, dissimilar, or missing.

IMPORTANT: estimatedValue MUST come from real sold comps, not guesses. No comps = low confidence.`;

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

function buildIdentificationPrompt(listing: Listing): string {
  return IDENTIFICATION_PROMPT
    .replace("{title}", listing.title)
    .replace("{price}", listing.price.toString())
    .replace("{description}", listing.description);
}

function buildValuationPrompt(listing: Listing, identification: IdentificationResult): string {
  // Derive search terms from the identification
  const searchTerms = identification.itemIdentification;
  return VALUATION_PROMPT
    .replace("{itemIdentification}", identification.itemIdentification)
    .replace("{estimatedEra}", identification.estimatedEra || "Unknown")
    .replace("{identificationConfidence}", identification.identificationConfidence.toFixed(2))
    .replace("{redFlags}", identification.redFlags.length > 0 ? identification.redFlags.join(", ") : "None")
    .replace("{title}", listing.title)
    .replace("{price}", listing.price.toString())
    .replace(/\{searchTerms\}/g, searchTerms);
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
  useSearch: boolean;
  timestamp: () => string;
  phaseLabel: string;
}

async function callGemini<T>(config: CallGeminiConfig<T>): Promise<{ result: T; references: string[] }> {
  const { prompt, imageParts, schema, useSearch, timestamp, phaseLabel } = config;
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
          ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
          responseMimeType: "application/json",
          responseSchema: schema,
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
      if (references.length > 0) {
        console.log(`[${timestamp()}]   ${phaseLabel}: Found ${references.length} grounding sources`);
      }

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
  type: Type.OBJECT,
  properties: {
    isAuthentic: { type: Type.BOOLEAN },
    itemIdentification: { type: Type.STRING },
    identificationConfidence: { type: Type.NUMBER },
    estimatedEra: { type: Type.STRING },
    redFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["isAuthentic", "itemIdentification", "identificationConfidence", "estimatedEra", "redFlags"],
};

const VALUATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    soldListings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          price: { type: Type.NUMBER },
          url: { type: Type.STRING },
        },
        required: ["title"],
      },
    },
    estimatedValue: { type: Type.NUMBER },
    currentPrice: { type: Type.NUMBER },
    margin: { type: Type.NUMBER },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ["soldListings", "currentPrice", "confidence", "reasoning"],
};

export async function evaluateListing(listing: Listing): Promise<Evaluation> {
  if (USE_MOCK_DATA) return getMockEvaluation(listing);
  const timestamp = () => new Date().toISOString();
  console.log(`[${timestamp()}] Evaluating: ${listing.title.slice(0, 50)}...`);

  const imageParts = await fetchListingImages(listing, timestamp);

  // Phase 1: Identification (with images + search for verification)
  const identificationPrompt = buildIdentificationPrompt(listing);
  const { result: identification, references: refs1 } = await callGemini<IdentificationResult>({
    prompt: identificationPrompt,
    imageParts,
    schema: IDENTIFICATION_SCHEMA,
    useSearch: true,
    timestamp,
    phaseLabel: "Phase 1: Identification",
  });

  console.log(`[${timestamp()}]   Identified as: ${identification.itemIdentification} (${(identification.identificationConfidence * 100).toFixed(0)}% confidence)`);

  // Phase 2: Valuation (search-heavy, uses identification context)
  const valuationPrompt = buildValuationPrompt(listing, identification);
  const { result: valuation, references: refs2 } = await callGemini<ValuationResult>({
    prompt: valuationPrompt,
    imageParts,
    schema: VALUATION_SCHEMA,
    useSearch: true,
    timestamp,
    phaseLabel: "Phase 2: Valuation",
  });

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
