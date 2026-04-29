import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScan, type ScanDeps } from "./scan";
import { filterListings } from "./services/filter";
import type { Listing, Evaluation, ScanConfig } from "./types";
import type { IdentificationResult, ValuationOutput } from "./services/evaluate";

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

const IDENTIFICATION: IdentificationResult = {
  ...STORY_DEFAULTS,
  isAuthentic: true,
  itemIdentification: "Pendleton Board Shirt, loop collar, wool, 1960s",
  itemIdentificationJapanese: "ペンドルトン ループカラー ボードシャツ 60s",
  identificationConfidence: 0.9,
  estimatedEra: "1960s",
  redFlags: ["Condition not fully visible"],
};

const VALUATION: ValuationOutput = {
  soldListings: [
    { title: "Pendleton loop collar board shirt sz M", price: 135, url: null },
    { title: "Pendleton wool plaid 60s board shirt", price: 110, url: "https://sold.example.com/1" },
  ],
  estimatedValue: 120,
  currentPrice: 45,
  margin: 75,
  priceScore: 0.625,
  confidence: 0.85,
  reasoning: "Pendleton board shirts with loop collars are collectible.",
  references: ["Similar sold for $135", "Grailed avg $110-150"],
};

const CONFIG: ScanConfig = {
  platform: "ebay",
  maxListings: 10,
  minMargin: 0,
  minConfidence: 0,
};

const TEST_USERS = [
  {
    id: "user-en",
    name: "test@example.com",
    email: "test@example.com",
    language: "en",
    googleId: null,
    createdAt: new Date(),
    keywords: [{ id: "kw-1", userId: "user-en", query: "vintage", percentage: 1.0, createdAt: new Date() }],
    votes: [],
  },
  {
    id: "user-zh",
    name: "test-zh@example.com",
    email: "test-zh@example.com",
    language: "zh",
    googleId: null,
    createdAt: new Date(),
    keywords: [{ id: "kw-2", userId: "user-zh", query: "vintage", percentage: 1.0, createdAt: new Date() }],
    votes: [],
  },
];

function createMockPrisma() {
  const evaluations: Record<string, any> = {};
  const stories: Record<string, any> = {};
  let idCounter = 0;

  return {
    user: {
      findMany: vi.fn(async () => TEST_USERS),
      findUnique: vi.fn(async ({ where }: any) => {
        const user = TEST_USERS.find(u => u.email === where.email || u.id === where.id);
        return user ? { ...user, votes: [] } : null;
      }),
      upsert: vi.fn(async ({ where, create }: any) => TEST_USERS.find(u => u.email === where.email) ?? create),
    },
    evaluation: {
      create: vi.fn(async ({ data }: any) => {
        const id = `eval-${++idCounter}`;
        const record = { id, ...data };
        evaluations[data.url] = record;
        return record;
      }),
      findUnique: vi.fn(async ({ where }: any) => evaluations[where.url] ?? null),
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
        const configId = data.configId ?? "en";
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
    vote: {
      upsert: vi.fn(async () => ({})),
    },
    storyDelivery: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: `delivery-${++idCounter}`, ...data })),
    },

    _store: { evaluations, stories },
  };
}

let mockPrisma: ReturnType<typeof createMockPrisma>;

function makeDeps(overrides?: Partial<ScanDeps>): ScanDeps {
  return {
    prisma: mockPrisma as any,
    fetchListings: async () => [LISTING],
    filterListings,
    runIdentification: async (_listing, lang) => ({
      ...IDENTIFICATION,
      hook: lang === "zh" ? `[ZH] ${IDENTIFICATION.hook}` : IDENTIFICATION.hook,
      brandStory: lang === "zh" ? `[ZH] ${IDENTIFICATION.brandStory}` : IDENTIFICATION.brandStory,
      itemStory: lang === "zh" ? `[ZH] ${IDENTIFICATION.itemStory}` : IDENTIFICATION.itemStory,
      historicalContext: lang === "zh" ? `[ZH] ${IDENTIFICATION.historicalContext}` : IDENTIFICATION.historicalContext,
      marketContext: lang === "zh" ? `[ZH] ${IDENTIFICATION.marketContext}` : IDENTIFICATION.marketContext,
      styleGuide: lang === "zh" ? `[ZH] ${IDENTIFICATION.styleGuide}` : IDENTIFICATION.styleGuide,
      storyScoreReasoning: lang === "zh" ? `[ZH] ${IDENTIFICATION.storyScoreReasoning}` : IDENTIFICATION.storyScoreReasoning,
    }),
    runValuation: async () => VALUATION,
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
    expect(Array.isArray(result[0].imageUrls)).toBe(true);
    expect(result[0].imageUrls).toEqual(LISTING.imageUrls);
    expect(typeof result[0].rawData).toBe("object");
  });

  it("evaluation create includes url", async () => {
    await runScan(CONFIG, makeDeps());

    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.evaluation.create.mock.calls[0][0].data;
    expect(data.url).toBe(LISTING.url);
  });

  it("evaluation create serializes arrays and includes priceScore", async () => {
    await runScan(CONFIG, makeDeps());

    const createCalls = mockPrisma.evaluation.create.mock.calls;
    expect(createCalls).toHaveLength(1);
    const data = createCalls[0][0].data;

    expect(typeof data.redFlags).toBe("string");
    expect(JSON.parse(data.redFlags)).toEqual(IDENTIFICATION.redFlags);
    expect(typeof data.references).toBe("string");
    expect(typeof data.soldListings).toBe("string");

    const parsedSold = JSON.parse(data.soldListings);
    expect(parsedSold).toEqual(VALUATION.soldListings);
    for (const sold of parsedSold) {
      expect(sold).toHaveProperty("title");
      expect(sold).toHaveProperty("price");
      expect(sold).toHaveProperty("url");
    }

    expect(typeof data.priceScore).toBe("number");
    expect(data.isOpportunity).toBe(true);
  });

  it("story create is called for EN and ZH users", async () => {
    await runScan(CONFIG, makeDeps());

    // 1 listing × 2 users (EN + ZH) = 2 story creates
    expect(mockPrisma.story.create).toHaveBeenCalledTimes(2);

    const enData = mockPrisma.story.create.mock.calls[0][0].data;
    expect(enData.language).toBe("en");
    expect(enData.hook).toBe(IDENTIFICATION.hook);

    const zhData = mockPrisma.story.create.mock.calls[1][0].data;
    expect(zhData.language).toBe("zh");
    expect(zhData.hook).toBe(`[ZH] ${IDENTIFICATION.hook}`);
  });

  it("low storyScore items are still evaluated and ranked", async () => {
    await runScan(CONFIG, makeDeps({
      runIdentification: async () => ({ ...IDENTIFICATION, storyScore: 0.2 }),
    }));

    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(1);
  });

  it("full round-trip: stored data can reconstruct original Listing", async () => {
    await runScan(CONFIG, makeDeps());

    const storedEval = mockPrisma._store.evaluations[LISTING.url] as any;
    expect(storedEval.url).toBe(LISTING.url);
    expect(JSON.parse(storedEval.redFlags)).toEqual(IDENTIFICATION.redFlags);
    expect(JSON.parse(storedEval.soldListings)).toEqual(VALUATION.soldListings);
    expect(storedEval.isAuthentic).toBe(IDENTIFICATION.isAuthentic);
    expect(storedEval.estimatedValue).toBe(VALUATION.estimatedValue);
  });
});
