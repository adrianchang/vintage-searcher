import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Listing, Evaluation } from "../types";

// Set to true to use mock evaluations for testing
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === "true";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const EVALUATION_PROMPT = `You are an expert in vintage clothing (pre-1980s). Analyze this listing and determine if it's authentic vintage and potentially underpriced.

Listing Title: {title}
Listed Price: ${"{price}"}
Description: {description}

Analyze the photos for:
- Labels/tags (union labels, care tags, brand logos)
- Stitching patterns (single vs chain stitch)
- Hardware (zippers - Talon, Crown vs modern YKK)
- Fabric patterns and construction
- Condition details

Respond with JSON only:
{
  "isAuthentic": boolean,        // Is this actually pre-1980s?
  "estimatedEra": string,        // e.g., "1960s" or "early 1970s"
  "estimatedValue": number,      // What it could sell for (USD)
  "currentPrice": number,        // The listed price
  "margin": number,              // estimatedValue - currentPrice
  "confidence": number,          // 0-1 score
  "reasoning": string,           // Why you think it's valuable/authentic
  "redFlags": string[],          // Potential issues
  "references": string[]         // Comparable sales, known labels, pricing sources
}`;

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 15000; // 15 seconds

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function evaluateListing(listing: Listing): Promise<Evaluation> {
  const shortTitle = listing.title.slice(0, 50);
  const timestamp = () => new Date().toISOString();

  if (USE_MOCK_DATA) {
    return getMockEvaluation(listing);
  }

  console.log(`[${timestamp()}] Evaluating: ${shortTitle}...`);

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // Fetch images and convert to base64
  console.log(`[${timestamp()}]   Fetching ${Math.min(listing.imageUrls.length, 4)} images...`);
  const imageParts: Array<{ inlineData: { data: string; mimeType: string } }> = [];

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

  const prompt = EVALUATION_PROMPT
    .replace("{title}", listing.title)
    .replace("{price}", listing.price.toString())
    .replace("{description}", listing.description);

  // Retry loop with exponential backoff for rate limits and network errors
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`[${timestamp()}]   Calling Gemini API${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}...`);
      const startTime = Date.now();
      const result = await model.generateContent([prompt, ...imageParts]);
      const elapsed = Date.now() - startTime;
      const text = result.response.text();

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log(`[${timestamp()}]   ✗ Failed to parse JSON from response (${elapsed}ms)`);
        throw new Error("Failed to parse LLM response as JSON");
      }

      const evaluation = JSON.parse(jsonMatch[0]) as Evaluation;
      console.log(`[${timestamp()}]   ✓ Evaluated in ${elapsed}ms - Era: ${evaluation.estimatedEra}, Margin: $${evaluation.margin ?? "N/A"}, Confidence: ${(evaluation.confidence * 100).toFixed(0)}%`);

      return evaluation;
    } catch (error: unknown) {
      lastError = error as Error;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Retry on rate limit (429) or network errors (fetch failed)
      const isRetryable = errorMsg.includes("429") || errorMsg.includes("fetch failed") || errorMsg.includes("ECONNRESET") || errorMsg.includes("ETIMEDOUT");

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        const reason = errorMsg.includes("429") ? "Rate limited" : "Network error";
        console.log(`[${timestamp()}]   ⚠ ${reason}: ${errorMsg.slice(0, 100)}`);
        console.log(`[${timestamp()}]   Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }

      // Log full error details before throwing
      console.log(`[${timestamp()}]   ✗ Error: ${errorMsg}`);
      throw error;
    }
  }

  // If we exhausted retries, throw the last error
  console.log(`[${timestamp()}]   ✗ Max retries exceeded`);
  throw lastError || new Error("Max retries exceeded");
}

// Mock evaluations based on listing URL (matches mock listings in ecommerce.ts)
function getMockEvaluation(listing: Listing): Evaluation {
  const mockEvaluations: Record<string, Evaluation> = {
    "https://www.ebay.com/itm/123456789001": {
      isAuthentic: true,
      estimatedEra: "1960s",
      estimatedValue: 120,
      currentPrice: 45,
      margin: 75,
      confidence: 0.85,
      reasoning: "Pendleton board shirts with loop collars are highly collectible. The loop collar indicates pre-1960s manufacture. Made in USA Pendleton wool shirts from this era typically sell for $100-150.",
      redFlags: ["Condition not fully visible in photos"],
      references: ["Similar Pendleton loop collar sold for $135 on eBay 2024", "Vintage Pendleton price guide"],
    },
    "https://www.ebay.com/itm/123456789002": {
      isAuthentic: true,
      estimatedEra: "1950s-1960s",
      estimatedValue: 200,
      currentPrice: 89,
      margin: 111,
      confidence: 0.6,
      reasoning: "Estate sale lots often contain hidden gems. The description mentions 50s/60s dresses. If even 2-3 pieces are authentic vintage in good condition, the lot could be worth significantly more.",
      redFlags: ["Mixed lot - quality varies", "Cannot verify individual pieces", "As-is condition"],
      references: ["Vintage dress lots typically yield 2-3x return for experienced resellers"],
    },
    "https://www.ebay.com/itm/123456789003": {
      isAuthentic: true,
      estimatedEra: "1960s",
      estimatedValue: 400,
      currentPrice: 150,
      margin: 250,
      confidence: 0.9,
      reasoning: "Big E Levi's 501s with redline selvedge are highly valuable. The single stitch construction confirms pre-1971 manufacture. Size 32x30 is desirable. Seller appears knowledgeable but price is still below market.",
      redFlags: ["Seller may know value - could be auction bait"],
      references: ["Big E 501s sold for $300-600 on eBay in 2024", "Levi's vintage dating guide confirms Big E = pre-1971"],
    },
    "https://www.ebay.com/itm/123456789004": {
      isAuthentic: true,
      estimatedEra: "1950s",
      estimatedValue: 85,
      currentPrice: 25,
      margin: 60,
      confidence: 0.5,
      reasoning: "Description suggests casual seller clearing estate. 'Grandmas coat' language indicates potential true vintage. Wool coats from 1950s can be valuable if from quality makers.",
      redFlags: ["Moth holes mentioned", "No label visible", "Only one photo", "Low confidence without more details"],
      references: ["1950s wool coats range $50-200 depending on maker and condition"],
    },
    "https://www.ebay.com/itm/123456789005": {
      isAuthentic: true,
      estimatedEra: "1950s",
      estimatedValue: 180,
      currentPrice: 35,
      margin: 145,
      confidence: 0.88,
      reasoning: "1950s bowling shirts with chain stitch embroidery are highly collectible. The two-tone design and custom embroidery ('Joes Auto Shop') add significant value. This is a prime example of underpriced vintage.",
      redFlags: [],
      references: ["Chain stitch bowling shirts sold $150-300 on vintage marketplaces", "Rockabilly collectors pay premium for authentic 50s pieces"],
    },
    "https://www.ebay.com/itm/123456789007": {
      isAuthentic: true,
      estimatedEra: "1970s",
      estimatedValue: 150,
      currentPrice: 55,
      margin: 95,
      confidence: 0.82,
      reasoning: "Deadstock 1970s Landlubber jeans are collectible. High waist bell bottoms are currently trending. Original tags add significant value. Size 26 waist is desirable for the vintage market.",
      redFlags: ["Verify deadstock claim - check for storage wear"],
      references: ["Deadstock 70s jeans typically sell $100-200", "Landlubber was popular 70s brand"],
    },
    "https://www.ebay.com/itm/123456789008": {
      isAuthentic: true,
      estimatedEra: "1960s-1970s",
      estimatedValue: 120,
      currentPrice: 40,
      margin: 80,
      confidence: 0.7,
      reasoning: "Blanket-lined denim chore coats are sought after in workwear market. 'Well worn with character' is desirable for this aesthetic. No brand tag suggests possible vintage work coat.",
      redFlags: ["No brand identification", "Heavy wear may limit value"],
      references: ["Vintage chore coats sell $80-200 depending on condition and brand"],
    },
    "https://www.ebay.com/itm/123456789009": {
      isAuthentic: true,
      estimatedEra: "1960s",
      estimatedValue: 175,
      currentPrice: 48,
      margin: 127,
      confidence: 0.92,
      reasoning: "ILGWU union label definitively dates this to 1960s. Sequin evening gowns from this era are highly collectible. The label provides authentication that most sellers overlook.",
      redFlags: ["Minor sequin loss mentioned"],
      references: ["ILGWU labels date pieces to 1900-1995, style suggests 1960s", "60s sequin gowns sell $150-300"],
    },
    "https://www.ebay.com/itm/123456789010": {
      isAuthentic: true,
      estimatedEra: "1990s",
      estimatedValue: 95,
      currentPrice: 75,
      margin: 20,
      confidence: 0.75,
      reasoning: "Made in USA Carhartt Detroit jackets are collectible but this appears to be 1990s production rather than true vintage. Still has value but margin is slim.",
      redFlags: ["Likely 1990s not pre-1980s", "Common item - many available"],
      references: ["90s Carhartt Detroit jackets sell $80-120"],
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
    estimatedEra: "Unknown",
    estimatedValue: listing.price,
    currentPrice: listing.price,
    margin: 0,
    confidence: 0.3,
    reasoning: "Unable to determine authenticity or value from available information.",
    redFlags: ["Insufficient data for evaluation"],
    references: [],
  };
}
