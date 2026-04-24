import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScan, type ScanDeps } from "./scan";
import { filterListings } from "./services/filter";
import type { Listing, Evaluation, ScanConfig } from "./types";

const STORY_DEFAULTS = {
  hook: "A garment from another era.",
  brandStory: "A brand with history.",
  itemStory: "A piece with details.",
  historicalContext: "A moment in time.",
  marketContext: "Real heads know this one.",
  storyScore: 0.8,
  storyScoreReasoning: "Strong narrative.",
};

const MOCK_LISTINGS: Listing[] = [
  {
    url: "https://www.ebay.com/itm/test-001",
    platform: "ebay",
    title: "Vintage 1960s Pendleton Wool Board Shirt Mens Medium Blue Plaid Loop Collar",
    price: 45,
    imageUrls: ["https://example.com/img1.jpg", "https://example.com/img2.jpg", "https://example.com/img3.jpg"],
    description: "Vintage Pendleton board shirt from the 1960s. Made in USA.",
    rawData: { itemId: "test-001", condition: "Pre-owned" },
  },
  {
    url: "https://www.ebay.com/itm/test-002",
    platform: "ebay",
    title: "1950s Rockabilly Bowling Shirt Chain Stitch Embroidery Two Tone",
    price: 35,
    imageUrls: ["https://example.com/img2.jpg", "https://example.com/img2b.jpg", "https://example.com/img2c.jpg"],
    description: "Cool old bowling shirt with chain stitch embroidery.",
    rawData: { itemId: "test-002", condition: "Pre-owned" },
  },
  {
    url: "https://www.ebay.com/itm/test-003",
    platform: "ebay",
    title: "NEW Vintage Style Reproduction 1940s Dress Swing Dance Costume",
    price: 65,
    imageUrls: ["https://example.com/img3.jpg"],
    description: "Brand new reproduction 1940s style swing dress.",
    rawData: { itemId: "test-003", condition: "New with tags" },
  },
];

const MOCK_EVALUATIONS: Record<string, Evaluation> = {
  "https://www.ebay.com/itm/test-001": {
    ...STORY_DEFAULTS,
    isAuthentic: true,
    itemIdentification: "Pendleton Board Shirt, loop collar, wool, 1960s",
    identificationConfidence: 0.9,
    estimatedEra: "1960s",
    estimatedValue: 120,
    currentPrice: 45,
    margin: 75,
    confidence: 0.85,
    reasoning: "Pendleton board shirts with loop collars are collectible.",
    redFlags: ["Condition not fully visible"],
    references: ["Similar sold for $135"],
    soldListings: [{ title: "Pendleton loop collar board shirt sz M", price: 135, url: null }],
  },
  "https://www.ebay.com/itm/test-002": {
    ...STORY_DEFAULTS,
    isAuthentic: true,
    itemIdentification: "1950s rayon bowling shirt, chain stitch embroidery",
    identificationConfidence: 0.92,
    estimatedEra: "1950s",
    estimatedValue: 180,
    currentPrice: 35,
    margin: 145,
    confidence: 0.88,
    reasoning: "Chain stitch bowling shirts are highly collectible.",
    redFlags: [],
    references: ["Chain stitch bowling shirts sold $150-300"],
    soldListings: [{ title: "1950s chain stitch bowling shirt two-tone", price: 225, url: null }],
  },
};

const config: ScanConfig = {
  platform: "ebay",
  maxListings: 10,
  minMargin: 0,
  minConfidence: 0,
};

function createMockPrisma() {
  const listings: Record<string, any> = {};
  const evaluations: Record<string, any> = {};
  const stories: Record<string, any> = {};
  let idCounter = 0;

  return {
    user: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    filteredListing: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const url = where.url;
        if (!listings[url]) {
          const id = `cuid-${++idCounter}`;
          listings[url] = { id, ...create };
        }
        return listings[url];
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return listings[where.url] ?? null;
      }),
      findMany: vi.fn(async () => Object.values(listings)),
    },
    evaluation: {
      create: vi.fn(async ({ data }: any) => {
        const id = `eval-${++idCounter}`;
        const listingId = data.listing.connect.id;
        const record = { id, listingId, ...data, listing: undefined };
        delete record.listing;
        evaluations[listingId] = record;
        return record;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return evaluations[where.listingId] ?? null;
      }),
    },
    story: {
      create: vi.fn(async ({ data }: any) => {
        const id = `story-${++idCounter}`;
        const evaluationId = data.evaluation.connect.id;
        const lang = data.language ?? "en";
        const key = `${evaluationId}:${lang}`;
        const record = { id, evaluationId, ...data, evaluation: undefined };
        delete record.evaluation;
        stories[key] = record;
        return record;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const { evaluationId, language } = where.evaluationId_language ?? {};
        return stories[`${evaluationId}:${language}`] ?? null;
      }),
    },
    _store: { listings, evaluations, stories },
  };
}

let mockPrisma: ReturnType<typeof createMockPrisma>;

function makeDeps(overrides?: Partial<ScanDeps>): ScanDeps {
  return {
    prisma: mockPrisma as any,
    fetchListings: async () => MOCK_LISTINGS,
    filterListings,
    evaluateListing: async (listing: Listing) => {
      const evaluation = MOCK_EVALUATIONS[listing.url];
      if (!evaluation) throw new Error(`No mock evaluation for ${listing.url}`);
      return evaluation;
    },
    runIdentification: async (listing: Listing) => {
      const evaluation = MOCK_EVALUATIONS[listing.url];
      if (!evaluation) throw new Error(`No mock evaluation for ${listing.url}`);
      return {
        isAuthentic: evaluation.isAuthentic,
        itemIdentification: evaluation.itemIdentification,
        itemIdentificationJapanese: evaluation.itemIdentification,
        identificationConfidence: evaluation.identificationConfidence,
        estimatedEra: evaluation.estimatedEra ?? "Unknown",
        redFlags: evaluation.redFlags,
        hook: `[ZH] ${evaluation.hook}`,
        brandStory: `[ZH] ${evaluation.brandStory}`,
        itemStory: `[ZH] ${evaluation.itemStory}`,
        historicalContext: `[ZH] ${evaluation.historicalContext}`,
        marketContext: `[ZH] ${evaluation.marketContext}`,
        storyScore: evaluation.storyScore,
        storyScoreReasoning: `[ZH] ${evaluation.storyScoreReasoning}`,
      };
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockPrisma = createMockPrisma();
});

describe("runScan", () => {
  it("should store filtered listings (reproduction filtered out)", async () => {
    await runScan(config, makeDeps());

    // 3 listings in, but "reproduction" gets filtered → 2 upserts
    expect(mockPrisma.filteredListing.upsert).toHaveBeenCalledTimes(2);

    const storedUrls = Object.keys(mockPrisma._store.listings).sort();
    expect(storedUrls).toEqual([
      "https://www.ebay.com/itm/test-001",
      "https://www.ebay.com/itm/test-002",
    ]);
  });

  it("should create evaluations and stories for each filtered listing", async () => {
    await runScan(config, makeDeps());

    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(2);
    // 2 listings × 2 languages (EN + ZH) = 4 story creates
    expect(mockPrisma.story.create).toHaveBeenCalledTimes(4);
  });

  it("should skip already-evaluated listings on re-run", async () => {
    const deps = makeDeps();
    await runScan(config, deps);
    await runScan(config, deps);

    // Second run finds existing evaluations and skips
    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(2); // not 4
  });

  it("should mark low-storyScore items as not opportunities", async () => {
    const weakEval: Evaluation = {
      ...STORY_DEFAULTS,
      storyScore: 0.2, // low — combinedScore will be below threshold
      isAuthentic: true,
      itemIdentification: "Generic item",
      identificationConfidence: 0.5,
      estimatedEra: "1990s",
      estimatedValue: 50,
      currentPrice: 45,
      margin: 5,
      confidence: 0.5,
      reasoning: "Not much here.",
      redFlags: [],
      references: [],
      soldListings: [],
    };

    await runScan(config, makeDeps({
      evaluateListing: async () => weakEval,
    }));

    const evals = Object.values(mockPrisma._store.evaluations) as any[];
    expect(evals.every((e) => e.isOpportunity === false)).toBe(true);
  });

  it("should continue scanning when a single evaluation fails", async () => {
    let callCount = 0;
    await runScan(config, makeDeps({
      evaluateListing: async (listing) => {
        callCount++;
        if (listing.url === "https://www.ebay.com/itm/test-001") {
          throw new Error("Gemini API error");
        }
        return MOCK_EVALUATIONS[listing.url]!;
      },
    }));

    expect(callCount).toBe(2);
    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(1);
  });

  it("should serialize redFlags and references as JSON strings", async () => {
    await runScan(config, makeDeps());

    const createCalls = mockPrisma.evaluation.create.mock.calls;
    const firstEvalData = createCalls[0][0].data;

    expect(typeof firstEvalData.redFlags).toBe("string");
    expect(typeof firstEvalData.references).toBe("string");
    expect(JSON.parse(firstEvalData.redFlags)).toBeInstanceOf(Array);
    expect(JSON.parse(firstEvalData.references)).toBeInstanceOf(Array);
    expect(typeof firstEvalData.soldListings).toBe("string");
    expect(JSON.parse(firstEvalData.soldListings)).toBeInstanceOf(Array);
  });
});
