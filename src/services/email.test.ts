import { describe, it, expect } from "vitest";
import { buildClickUrl } from "./email";

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
