import { describe, it, expect } from "vitest";
import type { Evaluation } from "../types";
import { priceScore, combinedScore, isGoodFind } from "./score";

const STORY_DEFAULTS = {
  hook: "A garment from another era.",
  brandStory: "A brand with history.",
  itemStory: "A piece with details.",
  historicalContext: "A moment in time.",
  marketContext: "Real heads know this one.",
  styleGuide: "Wear it with raw denim and a clean tee.",
  storyScore: 0.8,
  storyScoreReasoning: "Strong narrative.",
};

describe("Scoring logic", () => {
  it("priceScore returns 0 for margin below $20", () => {
    const ev: Evaluation = {
      ...STORY_DEFAULTS,
      isAuthentic: true,
      itemIdentification: "Item",
      identificationConfidence: 0.9,
      estimatedEra: "1960s",
      estimatedValue: 120,
      currentPrice: 110,
      margin: 10,
      confidence: 0.85,
      reasoning: "",
      redFlags: [],
      references: [],
      soldListings: [],
    };
    expect(priceScore(ev)).toBe(0);
  });

  it("priceScore normalizes margin/estimatedValue, capped at 1", () => {
    const ev: Evaluation = {
      ...STORY_DEFAULTS,
      isAuthentic: true,
      itemIdentification: "Item",
      identificationConfidence: 0.9,
      estimatedEra: "1960s",
      estimatedValue: 120,
      currentPrice: 45,
      margin: 75,
      confidence: 0.85,
      reasoning: "",
      redFlags: [],
      references: [],
      soldListings: [],
    };
    expect(priceScore(ev)).toBeCloseTo(75 / 120);
  });

  it("combinedScore weights story 80% and price 20%", () => {
    const ev: Evaluation = {
      ...STORY_DEFAULTS,
      storyScore: 0.9,
      isAuthentic: true,
      itemIdentification: "Item",
      identificationConfidence: 0.9,
      estimatedEra: "1960s",
      estimatedValue: 200,
      currentPrice: 50,
      margin: 150,
      confidence: 0.85,
      reasoning: "",
      redFlags: [],
      references: [],
      soldListings: [],
    };
    const pScore = priceScore(ev); // 150/200 = 0.75
    const expected = 0.9 * 0.8 + pScore * 0.2;
    expect(combinedScore(ev)).toBeCloseTo(expected);
  });

  it("isGoodFind returns false when storyScore is low and no price upside", () => {
    const ev: Evaluation = {
      ...STORY_DEFAULTS,
      storyScore: 0.3,
      isAuthentic: false,
      itemIdentification: "Unknown",
      identificationConfidence: 0.1,
      estimatedEra: "Unknown",
      estimatedValue: null,
      currentPrice: 50,
      margin: null,
      confidence: 0.3,
      reasoning: "",
      redFlags: [],
      references: [],
      soldListings: [],
    };
    expect(isGoodFind(ev)).toBe(false);
  });

  it("isGoodFind returns true for high story score even with modest price upside", () => {
    const ev: Evaluation = {
      ...STORY_DEFAULTS,
      storyScore: 0.85,
      isAuthentic: true,
      itemIdentification: "Iconic piece",
      identificationConfidence: 0.95,
      estimatedEra: "1960s",
      estimatedValue: 150,
      currentPrice: 80,
      margin: 70,
      confidence: 0.9,
      reasoning: "",
      redFlags: [],
      references: [],
      soldListings: [],
    };
    expect(isGoodFind(ev)).toBe(true);
  });
});
