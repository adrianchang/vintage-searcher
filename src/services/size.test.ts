import { describe, it, expect } from "vitest";
import {
  coercePitToPitInches,
  coerceWaistInches,
  quoteSupportsMeasurement,
  parseTopSizeLabel,
  parseWaistLabel,
  isVintageEra,
  descriptionSupportsMeasurement,
  normalizeSizeExtraction,
  labelToPitToPitRange,
  computeSizeFit,
  hasSizeProfile,
  formatGarmentSize,
  SIZE_UNKNOWN_PENALTY,
  type UserSizeProfile,
} from "./size";

const mUser: UserSizeProfile = { topSize: "M", waistSize: 32, pitToPitInches: null };
const noSizeUser: UserSizeProfile = { topSize: null, waistSize: null, pitToPitInches: null };

describe("coercePitToPitInches", () => {
  it("accepts plausible inch values as-is", () => {
    expect(coercePitToPitInches(21.5)).toBe(21.5);
  });
  it("converts cm values", () => {
    expect(coercePitToPitInches(56)).toBeCloseTo(22, 0); // 56cm ≈ 22"
  });
  it("halves chest circumference", () => {
    expect(coercePitToPitInches(112)).toBeCloseTo(22, 0); // 112cm chest → 44" → 22" flat
  });
  it("rejects garbage", () => {
    expect(coercePitToPitInches(3)).toBeNull();
    expect(coercePitToPitInches(500)).toBeNull();
    expect(coercePitToPitInches(null)).toBeNull();
    expect(coercePitToPitInches(NaN)).toBeNull();
  });
});

describe("coerceWaistInches", () => {
  it("accepts tag waist as-is", () => {
    expect(coerceWaistInches(32)).toBe(32);
  });
  it("doubles a flat waist measurement", () => {
    expect(coerceWaistInches(16)).toBe(32);
  });
  it("converts cm", () => {
    expect(coerceWaistInches(82)).toBeCloseTo(32.3, 1);
  });
});

describe("label parsing", () => {
  it("normalizes label variants", () => {
    expect(parseTopSizeLabel("Large")).toBe("L");
    expect(parseTopSizeLabel("X-Large")).toBe("XL");
    expect(parseTopSizeLabel("2XL")).toBe("XXL");
    expect(parseTopSizeLabel("Men's L")).toBe("L");
    expect(parseTopSizeLabel("m")).toBe("M");
    expect(parseTopSizeLabel("Regular")).toBeNull();
  });
  it("parses waist from bottoms labels", () => {
    expect(parseWaistLabel("32x30")).toBe(32);
    expect(parseWaistLabel("W34 L32")).toBe(34);
    expect(parseWaistLabel("32")).toBe(32);
    expect(parseWaistLabel("no size")).toBeNull();
  });
});

describe("isVintageEra", () => {
  it("detects pre-90s decades", () => {
    expect(isVintageEra("1970s")).toBe(true);
    expect(isVintageEra("1960s-1970s")).toBe(true);
    expect(isVintageEra("1990s")).toBe(false);
    expect(isVintageEra("2000s")).toBe(false);
    expect(isVintageEra(null)).toBe(false);
  });
});

describe("descriptionSupportsMeasurement", () => {
  it("finds a stated inch measurement", () => {
    expect(descriptionSupportsMeasurement("Great shirt. Pit to pit 22 inches.", 22)).toBe(true);
  });
  it("finds a cm measurement matching the reported inches", () => {
    expect(descriptionSupportsMeasurement("身幅 56cm", 22)).toBe(true);
  });
  it("finds a chest circumference matching flat inches", () => {
    expect(descriptionSupportsMeasurement("chest: 44 in", 22)).toBe(true);
  });
  it("rejects when no supporting number exists", () => {
    expect(descriptionSupportsMeasurement("Vintage 1970s shirt, great condition", 22)).toBe(false);
  });
});

describe("quoteSupportsMeasurement", () => {
  const text = "Nice shirt. Laid flat it measures 56 cm across. Size L tag.";
  it("verifies a quote that appears in the text with a matching number", () => {
    expect(quoteSupportsMeasurement("measures 56 cm across", text, 22)).toBe(true);
  });
  it("rejects a quote that is not in the text", () => {
    expect(quoteSupportsMeasurement("pit to pit 22 inches", text, 22)).toBe(false);
  });
  it("rejects a quote without a number matching the reported value", () => {
    expect(quoteSupportsMeasurement("Size L tag", text, 22)).toBe(false);
  });
  it("rejects empty/short quotes", () => {
    expect(quoteSupportsMeasurement(null, text, 22)).toBe(false);
    expect(quoteSupportsMeasurement("56", text, 22)).toBe(false);
  });
});

describe("normalizeSizeExtraction", () => {
  it("verifies description evidence against listing text", () => {
    const result = normalizeSizeExtraction(
      { garmentType: "top", labeledSize: "L", pitToPitInches: 22, evidenceType: "description_text", evidenceQuote: "pit to pit 22" },
      "Vintage shirt, pit to pit 22 inches",
    );
    expect(result.pitToPitInches).toBe(22);
    expect(result.sizeConfidence).toBeCloseTo(0.75);
  });

  it("discards unverifiable description measurements (hallucination guard)", () => {
    const result = normalizeSizeExtraction(
      { garmentType: "top", labeledSize: null, pitToPitInches: 22, evidenceType: "description_text" },
      "Vintage shirt, great condition",
    );
    expect(result.pitToPitInches).toBeNull();
    expect(result.sizeEvidence).toBe("none");
    expect(result.sizeConfidence).toBe(0);
  });

  it("falls back to the tag when a fabricated measurement is discarded (flight-jacket case)", () => {
    // Real prod case: model reported 27"/44" as description_text while quoting
    // "Size: X-Large" — a quote with no matching number must not verify.
    const result = normalizeSizeExtraction(
      { garmentType: "outerwear", labeledSize: "X-LARGE", pitToPitInches: 27, waistInches: 44, evidenceType: "description_text", evidenceQuote: "Size: X-Large" },
      "Authentic CWU-45/P flight jacket. Size: X-Large. 100% Nomex.",
    );
    expect(result.pitToPitInches).toBeNull();
    expect(result.waistInches).toBeNull();
    expect(result.sizeEvidence).toBe("tag_only");
    expect(result.labeledSize).toBe("X-LARGE");
    expect(result.sizeConfidence).toBe(0.3);
  });

  it("verifies via the evidence quote when no measurement keyword is present", () => {
    const result = normalizeSizeExtraction(
      { garmentType: "top", labeledSize: null, pitToPitInches: 22, evidenceType: "description_text", evidenceQuote: "measures 22 inches across the front" },
      "Beautiful vintage shirt. Measures 22 inches across the front when laid flat.",
    );
    expect(result.pitToPitInches).toBe(22);
    expect(result.sizeConfidence).toBe(0.75);
  });

  it("corroborates seller_specifics measurements against the aspects text", () => {
    const result = normalizeSizeExtraction(
      { garmentType: "top", labeledSize: "M", pitToPitInches: 21, evidenceType: "seller_specifics", evidenceQuote: "Chest Size: 42 in" },
      "Vintage shirt title Chest Size: 42 in Size: M", // scan.ts appends aspects to the text
    );
    expect(result.pitToPitInches).toBe(21); // 42 circumference → 21 flat
    expect(result.sizeConfidence).toBe(0.6);
  });

  it("drops measurements when evidence is tag_only (back-derived guesses)", () => {
    const result = normalizeSizeExtraction(
      { garmentType: "top", labeledSize: "L", pitToPitInches: 22.5, evidenceType: "tag_only" },
      "Size L shirt",
    );
    expect(result.pitToPitInches).toBeNull();
    expect(result.sizeEvidence).toBe("tag_only");
    expect(result.sizeConfidence).toBe(0.3);
  });

  it("coerces cm measurements from raw extraction", () => {
    const result = normalizeSizeExtraction(
      { garmentType: "top", labeledSize: null, pitToPitInches: 56, evidenceType: "description_text" },
      "身幅 56cm",
    );
    expect(result.pitToPitInches).toBeCloseTo(22, 0);
  });

  it("caps confidence when measurement wildly contradicts the label", () => {
    const result = normalizeSizeExtraction(
      { garmentType: "top", labeledSize: "XS", pitToPitInches: 27, evidenceType: "description_text" },
      "pit to pit 27 in, tag size XS",
    );
    expect(result.sizeConfidence).toBeLessThanOrEqual(0.3);
  });

  it("handles a missing sizing block", () => {
    const result = normalizeSizeExtraction(undefined, "whatever");
    expect(result.garmentType).toBe("other");
    expect(result.sizeEvidence).toBe("none");
    expect(result.sizeConfidence).toBe(0);
  });
});

describe("labelToPitToPitRange", () => {
  it("maps modern L to the chart range widened by uncertainty", () => {
    expect(labelToPitToPitRange("L", "1990s")).toEqual({ lo: 21, hi: 24.5 });
  });
  it("shifts vintage labels down a size", () => {
    expect(labelToPitToPitRange("L", "1960s")).toEqual({ lo: 20, hi: 23.5 });
  });
  it("handles numeric chest sizing", () => {
    const range = labelToPitToPitRange("42R", null);
    expect(range).not.toBeNull();
    expect((range!.lo + range!.hi) / 2).toBeCloseTo(22.5);
  });
});

describe("computeSizeFit — tops", () => {
  const base = { garmentType: "top", labeledSize: null, pitToPitInches: null, waistInches: null, sizeConfidence: null, estimatedEra: null };

  it("matches a measured p2p inside the M band", () => {
    const { fit } = computeSizeFit({ ...base, pitToPitInches: 22, sizeConfidence: 0.75 }, mUser);
    expect(fit).toBe("match");
  });

  it("hard-mismatches a confident out-of-band measurement", () => {
    const { fit } = computeSizeFit({ ...base, pitToPitInches: 27, sizeConfidence: 0.75 }, mUser);
    expect(fit).toBe("mismatch");
  });

  it("degrades a low-confidence mismatch to unknown", () => {
    const { fit } = computeSizeFit({ ...base, pitToPitInches: 27, sizeConfidence: 0.35 }, mUser);
    expect(fit).toBe("unknown");
  });

  it("matches labels within ±1 size (vintage-adjusted)", () => {
    // vintage L → effective M → distance 0
    expect(computeSizeFit({ ...base, labeledSize: "L", sizeConfidence: 0.3, estimatedEra: "1960s" }, mUser).fit).toBe("match");
    // modern L → distance 1 ("slightly bigger")
    expect(computeSizeFit({ ...base, labeledSize: "L", sizeConfidence: 0.3 }, mUser).fit).toBe("match");
    // modern S → distance 1 ("slightly smaller")
    expect(computeSizeFit({ ...base, labeledSize: "S", sizeConfidence: 0.3 }, mUser).fit).toBe("match");
    // vintage XL → effective L → distance 1
    expect(computeSizeFit({ ...base, garmentType: "outerwear", labeledSize: "XL", sizeConfidence: 0.3, estimatedEra: "1970s" }, mUser).fit).toBe("match");
  });

  it("mismatches labels 2+ sizes away — tags are trusted", () => {
    // modern XL for an M user: 2 sizes up, excluded
    expect(computeSizeFit({ ...base, labeledSize: "XL", sizeConfidence: 0.3 }, mUser).fit).toBe("mismatch");
    // modern XS for an M user: 2 sizes down, excluded
    expect(computeSizeFit({ ...base, labeledSize: "XS", sizeConfidence: 0.3 }, mUser).fit).toBe("mismatch");
    // vintage S → effective XS → 2 down, excluded
    expect(computeSizeFit({ ...base, labeledSize: "S", sizeConfidence: 0.3, estimatedEra: "1960s" }, mUser).fit).toBe("mismatch");
    const xsUser: UserSizeProfile = { topSize: "XS", waistSize: null, pitToPitInches: null };
    expect(computeSizeFit({ ...base, labeledSize: "XXL", sizeConfidence: 0.3 }, xsUser).fit).toBe("mismatch");
  });

  it("treats unparseable labels as unknown", () => {
    const { fit } = computeSizeFit({ ...base, labeledSize: "One Size", sizeConfidence: 0.3 }, mUser);
    expect(fit).toBe("unknown");
  });

  it("derives the user's size index from their p2p for label matching", () => {
    const measuredUser: UserSizeProfile = { topSize: null, waistSize: null, pitToPitInches: 23 }; // ≈ L
    expect(computeSizeFit({ ...base, labeledSize: "XS", sizeConfidence: 0.3 }, measuredUser).fit).toBe("mismatch");
    expect(computeSizeFit({ ...base, labeledSize: "M", sizeConfidence: 0.3 }, measuredUser).fit).toBe("match");
  });

  it("is unknown with no size info at all", () => {
    const { fit } = computeSizeFit(base, mUser);
    expect(fit).toBe("unknown");
  });

  it("allows extra room for outerwear", () => {
    // 24" is outside the plain-top band for M (hi 23.5) but inside outerwear's
    const top = computeSizeFit({ ...base, pitToPitInches: 24, sizeConfidence: 0.75 }, mUser);
    const jacket = computeSizeFit({ ...base, garmentType: "outerwear", pitToPitInches: 24, sizeConfidence: 0.75 }, mUser);
    expect(top.fit).toBe("mismatch");
    expect(jacket.fit).toBe("match");
  });

  it("uses the user's own p2p measurement over their letter size", () => {
    const measuredUser: UserSizeProfile = { topSize: "M", waistSize: null, pitToPitInches: 23 };
    const { fit } = computeSizeFit({ ...base, pitToPitInches: 25, sizeConfidence: 0.75 }, measuredUser);
    expect(fit).toBe("match"); // 25 ≤ 23 + 0.75 slack + 2 above-tolerance
  });

  it("is not_applicable when the user gave no top size", () => {
    const waistOnly: UserSizeProfile = { topSize: null, waistSize: 32, pitToPitInches: null };
    const { fit } = computeSizeFit({ ...base, pitToPitInches: 27, sizeConfidence: 0.9 }, waistOnly);
    expect(fit).toBe("not_applicable");
  });
});

describe("computeSizeFit — bottoms", () => {
  const base = { garmentType: "bottom", labeledSize: null, pitToPitInches: null, waistInches: null, sizeConfidence: null, estimatedEra: null };

  it("matches a measured waist within tolerance", () => {
    const { fit } = computeSizeFit({ ...base, waistInches: 33, sizeConfidence: 0.75 }, mUser);
    expect(fit).toBe("match");
  });

  it("mismatches a confidently measured distant waist", () => {
    const { fit } = computeSizeFit({ ...base, waistInches: 38, sizeConfidence: 0.75 }, mUser);
    expect(fit).toBe("mismatch");
  });

  it("matches a vintage tag waist one up (runs small)", () => {
    const { fit } = computeSizeFit({ ...base, labeledSize: "33x30", sizeConfidence: 0.3, estimatedEra: "1970s" }, mUser);
    expect(fit).toBe("match");
  });

  it("mismatches a distant tag waist, unknowns the borderline", () => {
    // 36 modern for a 32 user: 4" off → excluded
    expect(computeSizeFit({ ...base, labeledSize: "36x32", sizeConfidence: 0.3 }, mUser).fit).toBe("mismatch");
    // 34 modern for a 32 user: 2" off → borderline → unknown (penalty)
    expect(computeSizeFit({ ...base, labeledSize: "34x32", sizeConfidence: 0.3 }, mUser).fit).toBe("unknown");
  });

  it("is not_applicable when the user gave no waist", () => {
    const topOnly: UserSizeProfile = { topSize: "M", waistSize: null, pitToPitInches: null };
    const { fit } = computeSizeFit({ ...base, waistInches: 44, sizeConfidence: 0.9 }, topOnly);
    expect(fit).toBe("not_applicable");
  });
});

describe("computeSizeFit — non-matchable garments", () => {
  it("skips footwear, accessories, and dresses", () => {
    for (const garmentType of ["footwear", "accessory", "dress", "other"]) {
      const { fit } = computeSizeFit(
        { garmentType, labeledSize: "10", pitToPitInches: null, waistInches: null, sizeConfidence: 0.5, estimatedEra: null },
        mUser,
      );
      expect(fit).toBe("not_applicable");
    }
  });
});

describe("profile helpers", () => {
  it("hasSizeProfile", () => {
    expect(hasSizeProfile(mUser)).toBe(true);
    expect(hasSizeProfile(noSizeUser)).toBe(false);
  });

  it("formatGarmentSize", () => {
    expect(formatGarmentSize({ labeledSize: "L", pitToPitInches: 22, waistInches: null }))
      .toBe('Tagged L · pit-to-pit 22"');
    expect(formatGarmentSize({ labeledSize: null, pitToPitInches: null, waistInches: null })).toBeNull();
  });

  it("penalty constant is a sane multiplier", () => {
    expect(SIZE_UNKNOWN_PENALTY).toBeGreaterThan(0.5);
    expect(SIZE_UNKNOWN_PENALTY).toBeLessThan(1);
  });
});
