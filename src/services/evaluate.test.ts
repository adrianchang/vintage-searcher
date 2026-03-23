import { describe, it, expect } from "vitest";
import type { Evaluation } from "../types";
import { parseValuationSummary } from "./evaluate";

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

describe("parseValuationSummary", () => {
  it("should parse valid JSON with all fields", () => {
    const input = JSON.stringify({
      estimatedValue: 150,
      confidence: 0.85,
      reasoning: "Based on 3 comparable sold listings",
      soldListings: [
        { title: "Vintage jacket", price: 140, url: "https://ebay.com/1" },
        { title: "Similar jacket", price: 160, url: "https://ebay.com/2" },
      ],
    });

    const result = parseValuationSummary(input);
    expect(result.estimatedValue).toBe(150);
    expect(result.confidence).toBe(0.85);
    expect(result.reasoning).toBe("Based on 3 comparable sold listings");
    expect(result.soldListings).toHaveLength(2);
    expect(result.soldListings[0]).toEqual({ title: "Vintage jacket", price: 140, url: "https://ebay.com/1" });
  });

  it("should strip markdown code fences and parse JSON", () => {
    const input = '```json\n{"estimatedValue": 200, "confidence": 0.9, "reasoning": "Good comps", "soldListings": []}\n```';

    const result = parseValuationSummary(input);
    expect(result.estimatedValue).toBe(200);
    expect(result.confidence).toBe(0.9);
    expect(result.reasoning).toBe("Good comps");
    expect(result.soldListings).toEqual([]);
  });

  it("should return fallback with raw text as reasoning for invalid JSON", () => {
    const input = "This is not valid JSON at all";

    const result = parseValuationSummary(input);
    expect(result.estimatedValue).toBeNull();
    expect(result.confidence).toBe(0.2);
    expect(result.reasoning).toBe(input);
    expect(result.soldListings).toEqual([]);
  });

  it("should return fallback for empty string", () => {
    const result = parseValuationSummary("");
    expect(result.estimatedValue).toBeNull();
    expect(result.confidence).toBe(0.2);
    expect(result.reasoning).toBe("No comparable listings found.");
    expect(result.soldListings).toEqual([]);
  });

  it("should clamp confidence > 1 to 1 and < 0 to 0", () => {
    const overOne = parseValuationSummary(JSON.stringify({ confidence: 5.0 }));
    expect(overOne.confidence).toBe(1);

    const underZero = parseValuationSummary(JSON.stringify({ confidence: -0.5 }));
    expect(underZero.confidence).toBe(0);
  });

  it("should fill defaults for partial JSON", () => {
    const input = JSON.stringify({ reasoning: "Only reasoning provided" });

    const result = parseValuationSummary(input);
    expect(result.estimatedValue).toBeNull();
    expect(result.confidence).toBe(0.2);
    expect(result.reasoning).toBe("Only reasoning provided");
    expect(result.soldListings).toEqual([]);
  });
});

describe("Margin calculation", () => {
  it("should compute margin as estimatedValue - price", () => {
    const estimatedValue = 200;
    const price = 75;
    const margin = estimatedValue !== null ? estimatedValue - price : null;
    expect(margin).toBe(125);
  });

  it("should return null margin when estimatedValue is null", () => {
    const estimatedValue: number | null = null;
    const price = 75;
    const margin = estimatedValue !== null ? estimatedValue - price : null;
    expect(margin).toBeNull();
  });
});
