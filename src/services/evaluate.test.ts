import { describe, it, expect } from "vitest";
import type { Evaluation } from "../types";

// Test the opportunity detection logic
function isOpportunity(
  evaluation: Evaluation,
  minMargin: number,
  minConfidence: number
): boolean {
  return (
    evaluation.margin != null &&
    evaluation.margin >= minMargin &&
    evaluation.confidence >= minConfidence
  );
}

describe("Opportunity Detection", () => {
  const minMargin = 50;
  const minConfidence = 0.7;

  it("should detect a valid opportunity", () => {
    const evaluation: Evaluation = {
      isAuthentic: true,
      itemIdentification: "Vintage 1960s item",
      identificationConfidence: 0.9,
      estimatedEra: "1960s",
      estimatedValue: 200,
      currentPrice: 100,
      margin: 100,
      confidence: 0.85,
      reasoning: "Authentic vintage item",
      redFlags: [],
      references: [],
      soldListings: [],
    };

    expect(isOpportunity(evaluation, minMargin, minConfidence)).toBe(true);
  });

  it("should reject when margin is below threshold", () => {
    const evaluation: Evaluation = {
      isAuthentic: true,
      itemIdentification: "1970s item",
      identificationConfidence: 0.8,
      estimatedEra: "1970s",
      estimatedValue: 120,
      currentPrice: 100,
      margin: 20, // Below minMargin of 50
      confidence: 0.85,
      reasoning: "Low margin item",
      redFlags: [],
      references: [],
      soldListings: [],
    };

    expect(isOpportunity(evaluation, minMargin, minConfidence)).toBe(false);
  });

  it("should reject when confidence is below threshold", () => {
    const evaluation: Evaluation = {
      isAuthentic: true,
      itemIdentification: "Possibly 1960s item",
      identificationConfidence: 0.5,
      estimatedEra: "1960s",
      estimatedValue: 200,
      currentPrice: 100,
      margin: 100,
      confidence: 0.5, // Below minConfidence of 0.7
      reasoning: "Uncertain authenticity",
      redFlags: ["Cannot verify label"],
      references: [],
      soldListings: [],
    };

    expect(isOpportunity(evaluation, minMargin, minConfidence)).toBe(false);
  });

  it("should reject when margin is null (non-vintage item)", () => {
    const evaluation: Evaluation = {
      isAuthentic: false,
      itemIdentification: "Modern production dress",
      identificationConfidence: 0.95,
      estimatedEra: "N/A (Modern Production)",
      estimatedValue: null,
      currentPrice: 59.4,
      margin: null,
      confidence: 1,
      reasoning: "This is a modern item, not vintage",
      redFlags: ["Item is modern, not vintage"],
      references: [],
      soldListings: [],
    };

    expect(isOpportunity(evaluation, minMargin, minConfidence)).toBe(false);
  });

  it("should reject when estimatedValue is null but margin is calculated as 0", () => {
    const evaluation: Evaluation = {
      isAuthentic: false,
      itemIdentification: "Unknown item",
      identificationConfidence: 0.1,
      estimatedEra: "Unknown",
      estimatedValue: null,
      currentPrice: 50,
      margin: null,
      confidence: 0.3,
      reasoning: "Unable to determine value",
      redFlags: ["Insufficient data"],
      references: [],
      soldListings: [],
    };

    expect(isOpportunity(evaluation, minMargin, minConfidence)).toBe(false);
  });
});
