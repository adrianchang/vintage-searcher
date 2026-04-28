import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScan, type ScanDeps } from "./scan";
import { filterListings } from "./services/filter";
import type { Listing, Evaluation, ScanConfig } from "./types";

const STORY_DEFAULTS = {
  hook: "Before fast fashion, this jacket outlasted everything.",
  brandStory: "Founded in the Pacific Northwest, this brand built garments to last generations.",
  itemStory: "The loop collar, visible in the photos, was phased out after the early 1960s.",
  historicalContext: "Post-war American manufacturing was at its peak.",
  marketContext: "Loop-collar Pendletons are a grail. Three collector bases chasing the same shirt.",
  styleGuide: "Wear it open over a white tee with raw denim. Classic Americana wardrobe anchor.",
  storyScore: 0.8,
  storyScoreReasoning: "Strong brand narrative with authenticating construction detail.",
};

const LISTING: Listing = {
  url: "https://www.ebay.com/itm/pipe-001",
  platform: "ebay",
  title: "Vintage 1960s Pendleton Wool Board Shirt Mens Medium Blue Plaid Loop Collar",
  price: 45,
  imageUrls: ["https://example.com/img1.jpg", "https://example.com/img1b.jpg", "https://example.com/img1c.jpg"],
  description: "Vintage Pendleton board shirt from the 1960s. Made in USA.",
  rawData: { itemId: "pipe-001", condition: "Pre-owned", seller: "vintagefinds" },
};

const EVALUATION: Evaluation = {
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
  references: ["Similar sold for $135", "Grailed avg $110-150"],
  soldListings: [
    { title: "Pendleton loop collar board shirt sz M", price: 135, url: null },
    { title: "Pendleton wool plaid 60s board shirt", price: 110, url: "https://sold.example.com/1" },
  ],
};

const CONFIG: ScanConfig = {
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
      update: vi.fn(async ({ where, data }: any) => {
        const record = Object.values(evaluations).find((e: any) => e.id === where.id) as any;
        if (record) Object.assign(record, data);
        return record;
      }),
    },
    story: {
      create: vi.fn(async ({ data }: any) => {
        const id = `story-${++idCounter}`;
        const evaluationId = data.evaluation.connect.id;
        const lang = data.language ?? "en";
        const configId = data.configId ?? "en-default";
        const key = `${evaluationId}:${lang}:${configId}`;
        const record = { id, evaluationId, ...data, evaluation: undefined };
        delete record.evaluation;
        stories[key] = record;
        return record;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const { evaluationId, language, configId } = where.evaluationId_language_configId ?? {};
        return stories[`${evaluationId}:${language}:${configId}`] ?? null;
      }),
    },
    _store: { listings, evaluations, stories },
  };
}

let mockPrisma: ReturnType<typeof createMockPrisma>;

const TEST_CONFIG = [
  {
    id: "en-default",
    language: "en" as const,
    searchKeywords: [{ query: "vintage", count: 10 }],
    recipients: ["test@example.com"],
  },
  {
    id: "zh-default",
    language: "zh" as const,
    searchKeywords: [{ query: "vintage", count: 10 }],
    recipients: ["test-zh@example.com"],
  },
];

function makeDeps(overrides?: Partial<ScanDeps>): ScanDeps {
  return {
    prisma: mockPrisma as any,
    fetchListings: async () => [LISTING],
    filterListings,
    configs: TEST_CONFIG,
    evaluateListing: async () => EVALUATION,
    runIdentification: async (_listing, lang) => ({
      isAuthentic: EVALUATION.isAuthentic,
      itemIdentification: EVALUATION.itemIdentification,
      itemIdentificationJapanese: EVALUATION.itemIdentification,
      identificationConfidence: EVALUATION.identificationConfidence,
      estimatedEra: EVALUATION.estimatedEra ?? "Unknown",
      redFlags: EVALUATION.redFlags,
      hook: lang === "zh" ? `[ZH] ${EVALUATION.hook}` : EVALUATION.hook,
      brandStory: lang === "zh" ? `[ZH] ${EVALUATION.brandStory}` : EVALUATION.brandStory,
      itemStory: lang === "zh" ? `[ZH] ${EVALUATION.itemStory}` : EVALUATION.itemStory,
      historicalContext: lang === "zh" ? `[ZH] ${EVALUATION.historicalContext}` : EVALUATION.historicalContext,
      marketContext: lang === "zh" ? `[ZH] ${EVALUATION.marketContext}` : EVALUATION.marketContext,
      styleGuide: lang === "zh" ? `[ZH] ${EVALUATION.styleGuide}` : EVALUATION.styleGuide,
      storyScore: EVALUATION.storyScore,
      storyScoreReasoning: lang === "zh" ? `[ZH] ${EVALUATION.storyScoreReasoning}` : EVALUATION.storyScoreReasoning,
    }),
    ...overrides,
  };
}

beforeEach(() => {
  mockPrisma = createMockPrisma();
});

describe("Pipeline: fetch → filter → store → evaluate → store", () => {
  it("filter preserves Listing shape", async () => {
    const result = await filterListings([LISTING]);

    expect(result).toHaveLength(1);
    const out = result[0];
    expect(Array.isArray(out.imageUrls)).toBe(true);
    expect(out.imageUrls).toEqual(LISTING.imageUrls);
    expect(typeof out.rawData).toBe("object");
    expect(out.rawData).toEqual(LISTING.rawData);
  });

  it("listing upsert serializes arrays to JSON strings", async () => {
    await runScan(CONFIG, makeDeps());

    const upsertCalls = mockPrisma.filteredListing.upsert.mock.calls;
    // 1 listing × 2 configs = 2 upsert calls (deduped in DB by URL)
    expect(upsertCalls).toHaveLength(2);

    const create = upsertCalls[0][0].create;

    expect(typeof create.imageUrls).toBe("string");
    expect(JSON.parse(create.imageUrls)).toEqual(LISTING.imageUrls);
    expect(typeof create.rawData).toBe("string");
    expect(JSON.parse(create.rawData)).toEqual(LISTING.rawData);
    expect(create.url).toBe(LISTING.url);
    expect(create.title).toBe(LISTING.title);
    expect(create.price).toBe(LISTING.price);
  });

  it("evaluation create serializes arrays and computes isOpportunity via combinedScore", async () => {
    await runScan(CONFIG, makeDeps());

    const createCalls = mockPrisma.evaluation.create.mock.calls;
    expect(createCalls).toHaveLength(1);

    const data = createCalls[0][0].data;

    expect(typeof data.redFlags).toBe("string");
    expect(JSON.parse(data.redFlags)).toEqual(EVALUATION.redFlags);
    expect(typeof data.references).toBe("string");
    expect(JSON.parse(data.references)).toEqual(EVALUATION.references);
    expect(typeof data.soldListings).toBe("string");

    const parsedSold = JSON.parse(data.soldListings);
    expect(parsedSold).toEqual(EVALUATION.soldListings);
    for (const sold of parsedSold) {
      expect(sold).toHaveProperty("title");
      expect(sold).toHaveProperty("price");
      expect(sold).toHaveProperty("url");
    }

    // storyScore=0.8, priceScore=75/120≈0.625 → combinedScore≈0.765 > 0.7 → true
    expect(data.isOpportunity).toBe(true);
  });

  it("story create is called with correct fields for EN and ZH", async () => {
    await runScan(CONFIG, makeDeps());

    // EN story + ZH story = 2 calls
    expect(mockPrisma.story.create).toHaveBeenCalledTimes(2);

    const enData = mockPrisma.story.create.mock.calls[0][0].data;
    expect(enData.language).toBe("en");
    expect(enData.hook).toBe(EVALUATION.hook);
    expect(enData.brandStory).toBe(EVALUATION.brandStory);
    expect(enData.itemStory).toBe(EVALUATION.itemStory);
    expect(enData.historicalContext).toBe(EVALUATION.historicalContext);
    expect(enData.storyScore).toBe(EVALUATION.storyScore);
    expect(typeof enData.combinedScore).toBe("number");

    const zhData = mockPrisma.story.create.mock.calls[1][0].data;
    expect(zhData.language).toBe("zh");
    expect(zhData.hook).toBe(`[ZH] ${EVALUATION.hook}`);
  });

  it("low storyScore items are still evaluated and ranked", async () => {
    const weakEval: Evaluation = {
      ...EVALUATION,
      storyScore: 0.2,
      estimatedValue: 50,
      margin: 5,
    };

    await runScan(CONFIG, makeDeps({
      evaluateListing: async () => weakEval,
    }));

    // Item is still evaluated — ranking replaces threshold filtering
    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(1);
  });

  it("full round-trip: stored data can reconstruct original Listing + Evaluation", async () => {
    await runScan(CONFIG, makeDeps());

    const storedListing = mockPrisma._store.listings[LISTING.url];
    expect(JSON.parse(storedListing.imageUrls)).toEqual(LISTING.imageUrls);
    expect(JSON.parse(storedListing.rawData)).toEqual(LISTING.rawData);
    expect(storedListing.url).toBe(LISTING.url);
    expect(storedListing.title).toBe(LISTING.title);
    expect(storedListing.price).toBe(LISTING.price);

    const storedEval = Object.values(mockPrisma._store.evaluations)[0] as any;
    expect(JSON.parse(storedEval.redFlags)).toEqual(EVALUATION.redFlags);
    expect(JSON.parse(storedEval.references)).toEqual(EVALUATION.references);
    expect(JSON.parse(storedEval.soldListings)).toEqual(EVALUATION.soldListings);
    expect(storedEval.isAuthentic).toBe(EVALUATION.isAuthentic);
    expect(storedEval.estimatedValue).toBe(EVALUATION.estimatedValue);
    expect(storedEval.margin).toBe(EVALUATION.margin);
  });
});
