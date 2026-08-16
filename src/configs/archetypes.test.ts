import { describe, it, expect } from "vitest";
import {
  selectActiveKeywords,
  mergeArchetypeKeywords,
  ARCHETYPES,
  ARCHETYPE_IDS,
  KEYWORD_ROTATION_WINDOW,
} from "./archetypes";

// Local shape matching KeywordConfig, avoids importing from digests just for a type
type KW = { query: string; percentage: number };

const POOL: KW[] = [
  { query: "a", percentage: 0.1 },
  { query: "b", percentage: 0.1 },
  { query: "c", percentage: 0.1 },
  { query: "d", percentage: 0.1 },
  { query: "e", percentage: 0.1 },
  { query: "f", percentage: 0.1 },
  { query: "g", percentage: 0.1 },
];

describe("selectActiveKeywords", () => {
  it("returns the whole pool unchanged when it's not longer than the window", () => {
    expect(selectActiveKeywords(POOL.slice(0, 3), 3, 5)).toEqual(POOL.slice(0, 3));
  });

  it("returns exactly windowSize items when the pool is longer", () => {
    expect(selectActiveKeywords(POOL, 3, 0)).toHaveLength(3);
  });

  it("advances by windowSize each day, deterministically", () => {
    expect(selectActiveKeywords(POOL, 3, 0).map(k => k.query)).toEqual(["a", "b", "c"]);
    expect(selectActiveKeywords(POOL, 3, 1).map(k => k.query)).toEqual(["d", "e", "f"]);
  });

  it("wraps around within a single day's window (pool not evenly divisible)", () => {
    // pool length 7, window 3: day 2 → offset 6 → indices 6,0,1
    expect(selectActiveKeywords(POOL, 3, 2).map(k => k.query)).toEqual(["g", "a", "b"]);
  });

  it("wraps the day cycle itself back to the start", () => {
    // offset = (dayIndex * windowSize) % poolLength; for windowSize=3, poolLength=7
    // (coprime), the offset only returns to 0 at dayIndex=7 (21 % 7 === 0)
    expect(selectActiveKeywords(POOL, 3, 7)).toEqual(selectActiveKeywords(POOL, 3, 0));
  });

  it("guarantees every keyword appears at least once over a full cycle", () => {
    const seen = new Set<string>();
    const cycleLength = Math.ceil(POOL.length / 3);
    for (let day = 0; day < cycleLength; day++) {
      selectActiveKeywords(POOL, 3, day).forEach(k => seen.add(k.query));
    }
    expect(seen.size).toBe(POOL.length);
  });

  it("same day always selects the same window (determinism, no hidden randomness)", () => {
    expect(selectActiveKeywords(POOL, 3, 42)).toEqual(selectActiveKeywords(POOL, 3, 42));
  });
});

describe("mergeArchetypeKeywords with rotation", () => {
  it("without dayIndex, uses each archetype's full pool (backward compatible — this is what /subscribe still calls)", () => {
    const full = mergeArchetypeKeywords(["americana"]);
    expect(full.length).toBe(ARCHETYPES.americana.keywords.length);
  });

  it("with dayIndex, narrows to the rotation window before merging", () => {
    const rotated = mergeArchetypeKeywords(["americana"], 0);
    expect(rotated.length).toBeLessThanOrEqual(KEYWORD_ROTATION_WINDOW);
    expect(rotated.length).toBeLessThan(ARCHETYPES.americana.keywords.length);
  });

  it("different days produce different active keyword sets for the same archetype", () => {
    const day0 = mergeArchetypeKeywords(["military"], 0).map(k => k.query).sort();
    const day1 = mergeArchetypeKeywords(["military"], 1).map(k => k.query).sort();
    expect(day0).not.toEqual(day1);
  });

  it("still renormalizes rotated weights to sum to 1.0", () => {
    const rotated = mergeArchetypeKeywords(["ivy", "biker"], 5);
    const sum = rotated.reduce((s, k) => s + k.percentage, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("same day + same archetype combo always resolves identically (so users sharing a config share the eBay fetch)", () => {
    const a = mergeArchetypeKeywords(["cowboy", "biker"], 10);
    const b = mergeArchetypeKeywords(["cowboy", "biker"], 10);
    expect(a).toEqual(b);
  });
});

describe("expanded keyword pools", () => {
  it("every archetype's pool is long enough for the rotation window to guarantee real day-to-day variety", () => {
    for (const id of ARCHETYPE_IDS) {
      expect(ARCHETYPES[id].keywords.length).toBeGreaterThan(KEYWORD_ROTATION_WINDOW);
    }
  });

  it("no duplicate query strings within a single archetype's pool", () => {
    for (const id of ARCHETYPE_IDS) {
      const queries = ARCHETYPES[id].keywords.map(k => k.query);
      expect(new Set(queries).size).toBe(queries.length);
    }
  });
});
