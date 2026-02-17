import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScan, type ScanDeps } from "./scan";
import { filterListings } from "./services/filter";
import type { Listing, Evaluation, ScanConfig } from "./types";

const MOCK_LISTINGS: Listing[] = [
  {
    url: "https://www.ebay.com/itm/test-001",
    platform: "ebay",
    title: "Vintage 1960s Pendleton Wool Board Shirt Mens Medium Blue Plaid Loop Collar",
    price: 45,
    imageUrls: ["https://example.com/img1.jpg"],
    description: "Vintage Pendleton board shirt from the 1960s. Made in USA.",
    rawData: { itemId: "test-001", condition: "Pre-owned" },
  },
  {
    url: "https://www.ebay.com/itm/test-002",
    platform: "ebay",
    title: "1950s Rockabilly Bowling Shirt Chain Stitch Embroidery Two Tone",
    price: 35,
    imageUrls: ["https://example.com/img2.jpg", "https://example.com/img2b.jpg"],
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
    isAuthentic: true,
    estimatedEra: "1960s",
    estimatedValue: 120,
    currentPrice: 45,
    margin: 75,
    confidence: 0.85,
    reasoning: "Pendleton board shirts with loop collars are collectible.",
    redFlags: ["Condition not fully visible"],
    references: ["Similar sold for $135"],
  },
  "https://www.ebay.com/itm/test-002": {
    isAuthentic: true,
    estimatedEra: "1950s",
    estimatedValue: 180,
    currentPrice: 35,
    margin: 145,
    confidence: 0.88,
    reasoning: "Chain stitch bowling shirts are highly collectible.",
    redFlags: [],
    references: ["Chain stitch bowling shirts sold $150-300"],
  },
};

const config: ScanConfig = {
  platform: "ebay",
  maxListings: 10,
  minMargin: 50,
  minConfidence: 0.7,
};

// In-memory store that mimics Prisma behavior
function createMockPrisma() {
  const listings: Record<string, any> = {};
  const evaluations: Record<string, any> = {};
  let idCounter = 0;

  return {
    user: {
      findUnique: vi.fn(async () => null),
    },
    searchQuery: {
      findMany: vi.fn(async () => []),
    },
    filteredListing: {
      upsert: vi.fn(async ({ where, create }: any) => {
        if (!listings[where.url]) {
          const id = `cuid-${++idCounter}`;
          listings[where.url] = { id, ...create };
        }
        return listings[where.url];
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
      findMany: vi.fn(async () => Object.values(evaluations)),
    },
    _store: { listings, evaluations },
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
    sendAlert: async () => {},
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

  it("should create evaluations for each filtered listing", async () => {
    await runScan(config, makeDeps());

    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(2);

    const evals = Object.values(mockPrisma._store.evaluations);
    expect(evals).toHaveLength(2);

    const pendleton = evals.find((e: any) => e.estimatedEra === "1960s") as any;
    expect(pendleton).toBeDefined();
    expect(pendleton.isAuthentic).toBe(true);
    expect(pendleton.estimatedValue).toBe(120);
    expect(pendleton.margin).toBe(75);
    expect(pendleton.confidence).toBe(0.85);
    expect(pendleton.isOpportunity).toBe(true);

    const bowling = evals.find((e: any) => e.estimatedEra === "1950s") as any;
    expect(bowling).toBeDefined();
    expect(bowling.margin).toBe(145);
    expect(bowling.isOpportunity).toBe(true);
  });

  it("should skip already-evaluated listings on re-run", async () => {
    const deps = makeDeps();
    await runScan(config, deps);
    await runScan(config, deps);

    // Second run should find existing evaluations and skip
    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(2); // not 4
  });

  it("should mark low-margin listings as not opportunities", async () => {
    const lowMarginEval: Evaluation = {
      isAuthentic: true,
      estimatedEra: "1990s",
      estimatedValue: 50,
      currentPrice: 45,
      margin: 5,
      confidence: 0.75,
      reasoning: "Not much margin here.",
      redFlags: [],
      references: [],
    };

    await runScan(config, makeDeps({
      evaluateListing: async () => lowMarginEval,
    }));

    const evals = Object.values(mockPrisma._store.evaluations) as any[];
    expect(evals).toHaveLength(2);
    expect(evals.every((e) => e.isOpportunity === false)).toBe(true);
  });

  it("should call sendAlert with opportunities", async () => {
    const alerted: { listing: Listing; evaluation: Evaluation }[] = [];

    await runScan(config, makeDeps({
      sendAlert: async (opps) => { alerted.push(...opps); },
    }));

    expect(alerted).toHaveLength(2);
    expect(alerted[0].listing.url).toBe("https://www.ebay.com/itm/test-001");
    expect(alerted[1].listing.url).toBe("https://www.ebay.com/itm/test-002");
  });

  it("should continue scanning when a single evaluation fails", async () => {
    let callCount = 0;
    await runScan(config, makeDeps({
      evaluateListing: async (listing) => {
        callCount++;
        if (listing.url === "https://www.ebay.com/itm/test-001") {
          throw new Error("Gemini API error");
        }
        return MOCK_EVALUATIONS[listing.url];
      },
    }));

    // Should have attempted both
    expect(callCount).toBe(2);
    // Only the successful one gets stored
    expect(mockPrisma.evaluation.create).toHaveBeenCalledTimes(1);
  });

  it("should not call sendAlert when there are no opportunities", async () => {
    const sendAlert = vi.fn();

    await runScan(config, makeDeps({
      evaluateListing: async () => ({
        isAuthentic: false,
        estimatedEra: "Unknown",
        estimatedValue: null,
        currentPrice: 45,
        margin: null,
        confidence: 0.3,
        reasoning: "Not vintage",
        redFlags: [],
        references: [],
      }),
      sendAlert,
    }));

    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("should serialize redFlags and references as JSON strings", async () => {
    await runScan(config, makeDeps());

    const createCalls = mockPrisma.evaluation.create.mock.calls;
    const firstEvalData = createCalls[0][0].data;

    expect(typeof firstEvalData.redFlags).toBe("string");
    expect(typeof firstEvalData.references).toBe("string");
    expect(JSON.parse(firstEvalData.redFlags)).toBeInstanceOf(Array);
    expect(JSON.parse(firstEvalData.references)).toBeInstanceOf(Array);
  });
});
