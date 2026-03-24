import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScan, type ScanDeps } from "./scan";
import { filterListings } from "./services/filter";
import type { Listing, Evaluation, ScanConfig } from "./types";

const LISTING: Listing = {
  url: "https://www.ebay.com/itm/pipe-001",
  platform: "ebay",
  title: "Vintage 1960s Pendleton Wool Board Shirt Mens Medium Blue Plaid Loop Collar",
  price: 45,
  imageUrls: ["https://example.com/img1.jpg", "https://example.com/img1b.jpg"],
  description: "Vintage Pendleton board shirt from the 1960s. Made in USA.",
  rawData: { itemId: "pipe-001", condition: "Pre-owned", seller: "vintagefinds" },
};

const EVALUATION: Evaluation = {
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
  minMargin: 50,
  minConfidence: 0.7,
};

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
        const url = where.userId_url?.url ?? where.url;
        if (!listings[url]) {
          const id = `cuid-${++idCounter}`;
          listings[url] = { id, ...create };
        }
        return listings[url];
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const url = where.userId_url?.url ?? where.url;
        return listings[url] ?? null;
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
    fetchListings: async () => [LISTING],
    filterListings,
    evaluateListing: async () => EVALUATION,
    sendAlert: async () => {},
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
    expect(out.rawData).not.toBeNull();
    expect(out.rawData).toEqual(LISTING.rawData);
  });

  it("listing upsert serializes arrays to JSON strings", async () => {
    await runScan(CONFIG, makeDeps());

    const upsertCalls = mockPrisma.filteredListing.upsert.mock.calls;
    expect(upsertCalls).toHaveLength(1);

    const create = upsertCalls[0][0].create;

    // imageUrls serialized to JSON string
    expect(typeof create.imageUrls).toBe("string");
    expect(JSON.parse(create.imageUrls)).toEqual(LISTING.imageUrls);

    // rawData serialized to JSON string
    expect(typeof create.rawData).toBe("string");
    expect(JSON.parse(create.rawData)).toEqual(LISTING.rawData);

    // Scalar fields match input
    expect(create.url).toBe(LISTING.url);
    expect(create.title).toBe(LISTING.title);
    expect(create.price).toBe(LISTING.price);
    expect(create.description).toBe(LISTING.description);
    expect("userId" in create).toBe(true);
  });

  it("evaluation create serializes arrays and computes isOpportunity", async () => {
    await runScan(CONFIG, makeDeps());

    const createCalls = mockPrisma.evaluation.create.mock.calls;
    expect(createCalls).toHaveLength(1);

    const data = createCalls[0][0].data;

    // redFlags serialized
    expect(typeof data.redFlags).toBe("string");
    expect(JSON.parse(data.redFlags)).toEqual(EVALUATION.redFlags);

    // references serialized
    expect(typeof data.references).toBe("string");
    expect(JSON.parse(data.references)).toEqual(EVALUATION.references);

    // soldListings serialized with correct shape
    expect(typeof data.soldListings).toBe("string");
    const parsedSold = JSON.parse(data.soldListings);
    expect(parsedSold).toEqual(EVALUATION.soldListings);
    for (const sold of parsedSold) {
      expect(sold).toHaveProperty("title");
      expect(sold).toHaveProperty("price");
      expect(sold).toHaveProperty("url");
    }

    // isOpportunity: margin=75 >= 50, confidence=0.85 >= 0.7 → true
    expect(data.isOpportunity).toBe(true);

    // listing.connect.id matches the upsert return value
    const storedListing = mockPrisma._store.listings[LISTING.url];
    expect(data.listing.connect.id).toBe(storedListing.id);
  });

  it("non-opportunity: low margin sets isOpportunity false", async () => {
    const lowMarginEval: Evaluation = {
      ...EVALUATION,
      estimatedValue: 50,
      margin: 5,
      confidence: 0.85,
    };

    await runScan(CONFIG, makeDeps({
      evaluateListing: async () => lowMarginEval,
    }));

    const data = mockPrisma.evaluation.create.mock.calls[0][0].data;
    expect(data.isOpportunity).toBe(false);
  });

  it("non-opportunity: null estimatedValue sets isOpportunity false", async () => {
    const nullValueEval: Evaluation = {
      ...EVALUATION,
      estimatedValue: null,
      margin: null,
      confidence: 0.3,
    };

    await runScan(CONFIG, makeDeps({
      evaluateListing: async () => nullValueEval,
    }));

    const data = mockPrisma.evaluation.create.mock.calls[0][0].data;
    expect(data.isOpportunity).toBe(false);
  });

  it("full round-trip: stored data can reconstruct original Listing + Evaluation", async () => {
    await runScan(CONFIG, makeDeps());

    // Reconstruct listing from stored record
    const storedListing = mockPrisma._store.listings[LISTING.url];
    expect(JSON.parse(storedListing.imageUrls)).toEqual(LISTING.imageUrls);
    expect(JSON.parse(storedListing.rawData)).toEqual(LISTING.rawData);
    expect(storedListing.url).toBe(LISTING.url);
    expect(storedListing.title).toBe(LISTING.title);
    expect(storedListing.price).toBe(LISTING.price);
    expect(storedListing.description).toBe(LISTING.description);

    // Reconstruct evaluation from stored record
    const storedEval = Object.values(mockPrisma._store.evaluations)[0] as any;
    expect(JSON.parse(storedEval.redFlags)).toEqual(EVALUATION.redFlags);
    expect(JSON.parse(storedEval.references)).toEqual(EVALUATION.references);
    expect(JSON.parse(storedEval.soldListings)).toEqual(EVALUATION.soldListings);
    expect(storedEval.isAuthentic).toBe(EVALUATION.isAuthentic);
    expect(storedEval.estimatedValue).toBe(EVALUATION.estimatedValue);
    expect(storedEval.margin).toBe(EVALUATION.margin);
    expect(storedEval.confidence).toBe(EVALUATION.confidence);
    expect(storedEval.reasoning).toBe(EVALUATION.reasoning);
  });
});
