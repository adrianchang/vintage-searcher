import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { postToThreads, resolveThreadsToken, type ThreadsStoryItem } from "./threads";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

const mockItem: ThreadsStoryItem = {
  itemIdentification: "Pendleton Board Shirt",
  estimatedEra: "1960s",
  currentPrice: 40,
  estimatedValue: 80,
  hook: "A quiet classic",
  mainStory: "Full story text.",
  imageUrl: "https://example.com/img.jpg",
  ebayUrl: "https://www.ebay.com/itm/123",
};

describe("postToThreads (account-aware)", () => {
  it("no-ops without hitting the network when the account's user id env var is unset", async () => {
    delete process.env.THREADS_USER_ID_EN;
    const fetchSpy = vi.spyOn(global, "fetch");
    await postToThreads("Title", "Intro", [mockItem], "some-token", "en");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops without hitting the network when there are no items", async () => {
    process.env.THREADS_USER_ID_EN = "12345";
    const fetchSpy = vi.spyOn(global, "fetch");
    await postToThreads("Title", "Intro", [], "some-token", "en");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("zh and en accounts read distinct user id env vars, independently of each other", async () => {
    process.env.THREADS_USER_ID = "zh-account-id";
    delete process.env.THREADS_USER_ID_EN;
    const fetchSpy = vi.spyOn(global, "fetch");

    // en should no-op (its env var is unset) even though zh's is set
    await postToThreads("Title", "Intro", [mockItem], "some-token", "en");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("resolveThreadsToken (account-aware)", () => {
  it("uses the account-specific env var and AppCredential key, not the other account's", async () => {
    process.env.THREADS_ACCESS_TOKEN = "zh-token";
    process.env.THREADS_ACCESS_TOKEN_EN = "en-token";

    const seen: string[] = [];
    const prisma = {
      appCredential: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
          seen.push(`find:${where.key}`);
          return null;
        }),
        upsert: vi.fn(async ({ where }: { where: { key: string } }) => {
          seen.push(`upsert:${where.key}`);
          return { key: where.key, value: "x", updatedAt: new Date() };
        }),
      },
    };

    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true } as Response);

    const token = await resolveThreadsToken(prisma as never, "en");
    expect(token).toBe("en-token");
    expect(seen).toContain("find:threads_access_token_en");
    expect(seen).toContain("upsert:threads_access_token_en");
    expect(seen.some((s) => s.includes("threads_access_token") && !s.includes("_en"))).toBe(false);
  });

  it("returns null when neither the stored nor env token is available for the account", async () => {
    delete process.env.THREADS_ACCESS_TOKEN_EN;
    const prisma = {
      appCredential: {
        findUnique: vi.fn(async () => null),
      },
    };
    const token = await resolveThreadsToken(prisma as never, "en");
    expect(token).toBeNull();
  });
});
