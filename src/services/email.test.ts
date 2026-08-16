import { describe, it, expect } from "vitest";
import { buildClickUrl, buildSubject, type DigestItem } from "./email";

function mockItem(itemIdentification: string): DigestItem {
  return {
    listing: {} as DigestItem["listing"],
    evaluation: { itemIdentification } as DigestItem["evaluation"],
    score: 1,
    storyId: "s1",
  };
}

describe("buildClickUrl", () => {
  it("builds a signed /go link with email and story id", () => {
    const url = new URL(buildClickUrl("test@example.com", "story-123"));
    expect(url.pathname).toBe("/go");
    expect(url.searchParams.get("e")).toBe("test@example.com");
    expect(url.searchParams.get("s")).toBe("story-123");
    expect(url.searchParams.get("t")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic and story-specific", () => {
    expect(buildClickUrl("a@b.com", "s1")).toBe(buildClickUrl("a@b.com", "s1"));
    const t1 = new URL(buildClickUrl("a@b.com", "s1")).searchParams.get("t");
    const t2 = new URL(buildClickUrl("a@b.com", "s2")).searchParams.get("t");
    expect(t1).not.toBe(t2);
  });
});

describe("buildSubject", () => {
  it("joins three item short names with an Oxford 'and' (en)", () => {
    const items = [
      mockItem("Pendleton Board Shirt, loop collar, wool, 1960s"),
      mockItem("Levi's Trucker Jacket, selvedge denim, 1960s"),
      mockItem("M-65 Field Jacket, olive drab, 1970s"),
    ];
    expect(buildSubject(items, "en")).toMatch(
      /^🏷️ Today's Selection: Pendleton Board Shirt, Levi's Trucker Jacket and M-65 Field Jacket · \w+ \d+$/,
    );
  });

  it("uses '、' and '和' for zh, keeping english item names", () => {
    const items = [
      mockItem("Pendleton Board Shirt, loop collar, wool, 1960s"),
      mockItem("Levi's Trucker Jacket, selvedge denim, 1960s"),
    ];
    expect(buildSubject(items, "zh")).toBe(
      `🏷️ 今日精選：Pendleton Board Shirt 和 Levi's Trucker Jacket · ${new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric" })}`,
    );
  });

  it("handles a single item with no conjunction", () => {
    const items = [mockItem("Pendleton Board Shirt, loop collar, wool, 1960s")];
    expect(buildSubject(items, "en")).toMatch(/^🏷️ Today's Selection: Pendleton Board Shirt · \w+ \d+$/);
  });
});
