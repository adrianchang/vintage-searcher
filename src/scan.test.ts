import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScan, type ScanDeps } from "./scan";
import { filterListings } from "./services/filter";
import type { Listing, Evaluation, ScanConfig } from "./types";
import type { IdentificationResult, ValuationOutput } from "./services/evaluate";

const STORY_DEFAULTS = {
  hook: "A garment from another era.",
  brandStory: "A brand with history.",
  itemStory: "A piece with details.",
  historicalContext: "A moment in time.",
  marketContext: "Real heads know this one.",
  styleGuide: "Wear it with raw denim and a clean tee. Americana wardrobe essential.",
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

const MOCK_IDENTIFICATIONS: Record<string, IdentificationResult> = {
  "https://www.ebay.com/itm/test-001": {
    ...STORY_DEFAULTS,
    isAuthentic: true,
    itemIdentification: "Pendleton Board Shirt, loop collar, wool, 1960s",
    itemIdentificationJapanese: "ペンドルトン ループカラー ボードシャツ 60s",
    identificationConfidence: 0.9,
    estimatedEra: "1960s",
    redFlags: ["Condition not fully visible"],
  },
  "https://www.ebay.com/itm/test-002": {
    ...STORY_DEFAULTS,
    isAuthentic: true,
    itemIdentification: "1950s rayon bowling shirt, chain stitch embroidery",
    itemIdentificationJapanese: "50年代 レーヨン ボウリングシャツ チェーンステッチ",
    identificationConfidence: 0.92,
    estimatedEra: "1950s",
    redFlags: [],
  },
};

const MOCK_VALUATIONS: Record<string, ValuationOutput> = {
  "https://www.ebay.com/itm/test-001": {
    soldListings: [{ title: "Pendleton loop collar board shirt sz M", price: 135, url: null }],
    estimatedValue: 120,
    currentPrice: 45,
    margin: 75,
    priceScore: 0.625,
    confidence: 0.85,
    reasoning: "Pendleton board shirts with loop collars are collectible.",
    references: ["Similar sold for $135"],
  },
  "https://www.ebay.com/itm/test-002": {
    soldListings: [{ title: "1950s chain stitch bowling shirt two-tone", price: 225, url: null }],
    estimatedValue: 180,
    currentPrice: 35,
    margin: 145,
    priceScore: 0.8,
    confidence: 0.88,
    reasoning: "Chain stitch bowling shirts are highly collectible.",
    references: ["Chain stitch bowling shirts sold $150-300"],
  },
};

const config: ScanConfig = {
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
  const listings: Record<string, any> = {};
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
    filteredListing: {
      upsert: vi.fn(async ({ where, create }: any) => {
        if (!listings[where.url]) listings[where.url] = { id: `cuid-${++idCounter}`, ...create };
        return listings[where.url];
      }),
      findUnique: vi.fn(async ({ where }: any) => listings[where.url] ?? null),
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
      findUnique: vi.fn(async ({ where }: any) => evaluations[where.listingId] ?? null),
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
    _store: { listings, evaluations, stories },
  };
}

let mockPrisma: ReturnType<typeof createMockPrisma>;

function makeDeps(overrides?: Partial<ScanDeps>): ScanDeps {
  return {
    prisma: mockPrisma as any,
    fetchListings: async (_platform, _count, _queries) => MOCK_LISTINGS,
    filterListings,
    runIdentification: async (listing: Listing, lang?: string) => {
      const id = MOCK_IDENTIFICATIONS[listing.url];
      if (!id) throw new Error(`No mock identification for ${listing.url}`);
      const prefix = lang === "zh" ? "[ZH] " : "";
      return {
        ...id,
        hook: `${prefix}${id.hook}`,
        brandStory: `${prefix}${id.brandStory}`,
        itemStory: `${prefix}${id.itemStory}`,
        historicalContext: `${prefix}${id.historicalContext}`,
        marketContext: `${prefix}${id.marketContext}`,
        styleGuide: `${prefix}${id.styleGuide}`,
        storyScoreReasoning: `${prefix}${id.storyScoreReasoning}`,
      };
    },
    runValuation: async (listing: Listing) => {
      const val = MOCK_VALUATIONS[listing.url];
      if (!val) throw new Error(`No mock valuation for ${listing.url}`);
      return val;
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

    // 2 listings pass filter, stored once globally (not per-user)
    expect(mockPrisma.filteredListing.upsert).toHaveBeenCalledTimes(2);

    const storedUrls = Object.keys(mockPrisma._store.listings).sort();
    expect(storedUrls).toEqual([
      "https://www.ebay.com/itm/test-001",
      "https://www.ebay.com/itm/test-002",
    ]);
  });

  it("should create evaluations once globally and stories per user language", async () => {
    await runScan(config, makeDeps());

    // 2 listings evaluated once each
    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(2);
    // 2 listings × 2 users (EN + ZH) = 4 stories
    expect(mockPrisma.story.create).toHaveBeenCalledTimes(4);
  });

  it("should skip already-evaluated listings on re-run", async () => {
    const deps = makeDeps();
    await runScan(config, deps);
    await runScan(config, deps);

    // Evaluations created only on first run
    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(2);
  });

  it("should still evaluate low-storyScore items (ranking replaces threshold)", async () => {
    const weakId: IdentificationResult = {
      ...MOCK_IDENTIFICATIONS["https://www.ebay.com/itm/test-001"]!,
      storyScore: 0.2,
    };
    await runScan(config, makeDeps({
      runIdentification: async () => weakId,
    }));

    expect(mockPrisma.evaluation.create.mock.calls.length).toBeGreaterThan(0);
  });

  it("should continue scanning when a single evaluation fails", async () => {
    let callCount = 0;
    await runScan(config, makeDeps({
      runIdentification: async (listing) => {
        callCount++;
        if (listing.url === "https://www.ebay.com/itm/test-001") {
          throw new Error("Gemini API error");
        }
        return MOCK_IDENTIFICATIONS[listing.url]!;
      },
    }));

    // test-001 throws for both phase 1 (eval) and story gen → test-002 succeeds
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
