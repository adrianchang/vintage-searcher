import { describe, it, expect } from "vitest";
import {
  coercePitToPitInches,
  coerceWaistInches,
  quoteSupportsMeasurement,
  textContainsLabel,
  parseTopSizeLabel,
  parseWaistLabel,
  isVintageEra,
  descriptionSupportsMeasurement,
  resolveTag,
  resolveMeasurement,
  resolveGarmentSize,
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
  it("halves cm chest circumference", () => {
    // (bare "44" is deliberately read cm-first → 17.3"; unambiguous
    // circumference handling is exercised via 112cm)
    expect(coercePitToPitInches(112)).toBeCloseTo(22, 0); // 112cm chest → 22" flat
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
    expect(parseWaistLabel("4x32")).toBeNull(); // juniors sizing — length must not read as waist
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

describe("textContainsLabel", () => {
  it("finds letter sizes by synonym token", () => {
    expect(textContainsLabel("Size: X-Large, great shape", "XL")).toBe(true);
    expect(textContainsLabel("Mens XL bomber", "X-LARGE")).toBe(true);
  });
  it("does not false-positive XL inside XXL", () => {
    expect(textContainsLabel("Size: XXL", "XL")).toBe(false);
  });
  it("finds waist labels by number", () => {
    expect(textContainsLabel("Vintage Levis 32 x 30 selvedge", "32x30")).toBe(true);
    expect(textContainsLabel("Vintage Levis jeans", "32x30")).toBe(false);
  });
});

describe("resolveTag", () => {
  const text = "Alpha Industries bomber, Size: X-Large, clean";

  it("accepts a corroborated text tag", () => {
    expect(resolveTag({ tagFromText: "XL" }, text)).toEqual({ label: "XL", contradicted: false });
  });
  it("drops an uncorroborated text tag (hallucination guard)", () => {
    expect(resolveTag({ tagFromText: "M" }, text)).toEqual({ label: null, contradicted: false });
  });
  it("accepts a photo-only tag", () => {
    expect(resolveTag({ tagFromPhoto: "L" }, "no size mentioned anywhere")).toEqual({ label: "L", contradicted: false });
  });
  it("confirms when photo and text agree (different formats)", () => {
    expect(resolveTag({ tagFromPhoto: "X-LARGE", tagFromText: "XL" }, text)).toEqual({ label: "XL", contradicted: false });
  });
  it("aborts when photo and text contradict", () => {
    expect(resolveTag({ tagFromPhoto: "M", tagFromText: "XL" }, text)).toEqual({ label: null, contradicted: true });
  });
});

describe("resolveMeasurement", () => {
  const text = "Beautiful shirt. Pit to pit 22 inches laid flat.";

  it("accepts a corroborated text measurement", () => {
    const r = resolveMeasurement({ textPitToPitInches: 22, textMeasurementQuote: "pit to pit 22 inches" }, text);
    expect(r).toEqual({ pitToPit: 22, waist: null, contradicted: false });
  });
  it("drops an uncorroborated text measurement", () => {
    const r = resolveMeasurement({ textPitToPitInches: 25 }, "no measurements here");
    expect(r).toEqual({ pitToPit: null, waist: null, contradicted: false });
  });
  it("accepts a photo-only measurement", () => {
    const r = resolveMeasurement({ photoPitToPitInches: 21.5 }, "no measurements in text");
    expect(r).toEqual({ pitToPit: 21.5, waist: null, contradicted: false });
  });
  it("prefers the (verifiable) text value when channels agree", () => {
    const r = resolveMeasurement({ photoPitToPitInches: 21.7, textPitToPitInches: 22, textMeasurementQuote: "pit to pit 22" }, text);
    expect(r.pitToPit).toBe(22);
  });
  it("aborts when photo and text contradict", () => {
    const r = resolveMeasurement({ photoPitToPitInches: 26, textPitToPitInches: 22, textMeasurementQuote: "pit to pit 22" }, text);
    expect(r).toEqual({ pitToPit: null, waist: null, contradicted: true });
  });
  it("coerces cm on both channels", () => {
    const r = resolveMeasurement({ textPitToPitInches: 56, textMeasurementQuote: "身幅 56cm" }, "身幅 56cm 着丈 70cm");
    expect(r.pitToPit).toBeCloseTo(22, 0);
  });
});

describe("resolveGarmentSize", () => {
  it("resolves tag+measurement when both confirm and agree", () => {
    const r = resolveGarmentSize(
      { garmentType: "top", tagFromText: "L", photoPitToPitInches: 22.5 },
      "Pendleton board shirt Size: L",
      "1990s",
    );
    expect(r).toEqual({ garmentType: "top", labeledSize: "L", pitToPitInches: 22.5, waistInches: null, resolution: "tag+measurement" });
  });

  it("discards sizing when tag and measurement disagree", () => {
    // XS tag with a 27" pit-to-pit — something is wrong, trust neither
    const r = resolveGarmentSize(
      { garmentType: "top", tagFromText: "XS", photoPitToPitInches: 27 },
      "shirt Size: XS",
      null,
    );
    expect(r.resolution).toBe("contradicted");
    expect(r.labeledSize).toBeNull();
    expect(r.pitToPitInches).toBeNull();
  });

  it("flight-jacket regression: invented text measurement is dropped, tag survives", () => {
    // Model reported 27/44 as text measurements while the text has none.
    const r = resolveGarmentSize(
      { garmentType: "outerwear", tagFromText: "X-LARGE", tagTextQuote: "Size: X-Large", textPitToPitInches: 27, textWaistInches: 44, textMeasurementQuote: "Size: X-Large" },
      "Authentic CWU-45/P flight jacket. Size: X-Large. 100% Nomex.",
      "1990s",
    );
    expect(r).toEqual({ garmentType: "outerwear", labeledSize: "X-LARGE", pitToPitInches: null, waistInches: null, resolution: "tag" });
  });

  it("vintage garments measuring a size small still agree with their tag", () => {
    // 1960s L measuring 21" flat — expected vintage drift, not a contradiction
    const r = resolveGarmentSize(
      { garmentType: "top", tagFromText: "L", textPitToPitInches: 21, textMeasurementQuote: "pit to pit 21" },
      "1960s loop collar shirt Size L, pit to pit 21 inches",
      "1960s",
    );
    expect(r.resolution).toBe("tag+measurement");
    expect(r.pitToPitInches).toBe(21);
  });

  it("handles a missing sizing block", () => {
    const r = resolveGarmentSize(undefined, "whatever", null);
    expect(r.garmentType).toBe("other");
    expect(r.resolution).toBe("none");
  });

  it("aborts everything when a process contradicts internally", () => {
    const r = resolveGarmentSize(
      { garmentType: "top", tagFromPhoto: "M", tagFromText: "XL", textPitToPitInches: 22, textMeasurementQuote: "pit to pit 22" },
      "shirt Size: XL, pit to pit 22 inches",
      null,
    );
    expect(r.resolution).toBe("contradicted");
    expect(r.pitToPitInches).toBeNull();
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
  const base = { garmentType: "top", labeledSize: null, pitToPitInches: null, waistInches: null, estimatedEra: null };

  it("matches a measured p2p inside the M band", () => {
    expect(computeSizeFit({ ...base, pitToPitInches: 22 }, mUser).fit).toBe("match");
  });

  it("mismatches an out-of-band measurement (confirmed by construction)", () => {
    expect(computeSizeFit({ ...base, pitToPitInches: 27 }, mUser).fit).toBe("mismatch");
  });

  it("matches labels within ±1 size (vintage-adjusted)", () => {
    expect(computeSizeFit({ ...base, labeledSize: "L", estimatedEra: "1960s" }, mUser).fit).toBe("match");
    expect(computeSizeFit({ ...base, labeledSize: "L" }, mUser).fit).toBe("match");
    expect(computeSizeFit({ ...base, labeledSize: "S" }, mUser).fit).toBe("match");
    expect(computeSizeFit({ ...base, garmentType: "outerwear", labeledSize: "XL", estimatedEra: "1970s" }, mUser).fit).toBe("match");
  });

  it("mismatches labels 2+ sizes away — tags are trusted", () => {
    expect(computeSizeFit({ ...base, labeledSize: "XL" }, mUser).fit).toBe("mismatch");
    expect(computeSizeFit({ ...base, labeledSize: "XS" }, mUser).fit).toBe("mismatch");
    expect(computeSizeFit({ ...base, labeledSize: "S", estimatedEra: "1960s" }, mUser).fit).toBe("mismatch");
    const xsUser: UserSizeProfile = { topSize: "XS", waistSize: null, pitToPitInches: null };
    expect(computeSizeFit({ ...base, labeledSize: "XXL" }, xsUser).fit).toBe("mismatch");
  });

  it("treats unparseable labels as unknown", () => {
    expect(computeSizeFit({ ...base, labeledSize: "One Size" }, mUser).fit).toBe("unknown");
  });

  it("derives the user's size index from their p2p for label matching", () => {
    const measuredUser: UserSizeProfile = { topSize: null, waistSize: null, pitToPitInches: 23 }; // ≈ L
    expect(computeSizeFit({ ...base, labeledSize: "XS" }, measuredUser).fit).toBe("mismatch");
    expect(computeSizeFit({ ...base, labeledSize: "M" }, measuredUser).fit).toBe("match");
  });

  it("is unknown with no size info at all", () => {
    expect(computeSizeFit(base, mUser).fit).toBe("unknown");
  });

  it("allows extra room for measured outerwear", () => {
    expect(computeSizeFit({ ...base, pitToPitInches: 24 }, mUser).fit).toBe("mismatch");
    expect(computeSizeFit({ ...base, garmentType: "outerwear", pitToPitInches: 24 }, mUser).fit).toBe("match");
  });

  it("uses the user's own p2p measurement over their letter size", () => {
    const measuredUser: UserSizeProfile = { topSize: "M", waistSize: null, pitToPitInches: 23 };
    expect(computeSizeFit({ ...base, pitToPitInches: 25 }, measuredUser).fit).toBe("match");
  });

  it("is not_applicable when the user gave no top size", () => {
    const waistOnly: UserSizeProfile = { topSize: null, waistSize: 32, pitToPitInches: null };
    expect(computeSizeFit({ ...base, pitToPitInches: 27 }, waistOnly).fit).toBe("not_applicable");
  });
});

describe("computeSizeFit — bottoms", () => {
  const base = { garmentType: "bottom", labeledSize: null, pitToPitInches: null, waistInches: null, estimatedEra: null };

  it("matches a measured waist within tolerance", () => {
    expect(computeSizeFit({ ...base, waistInches: 33 }, mUser).fit).toBe("match");
  });

  it("mismatches a measured distant waist", () => {
    expect(computeSizeFit({ ...base, waistInches: 38 }, mUser).fit).toBe("mismatch");
  });

  it("matches a vintage tag waist one up (runs small)", () => {
    expect(computeSizeFit({ ...base, labeledSize: "33x30", estimatedEra: "1970s" }, mUser).fit).toBe("match");
  });

  it("mismatches a distant tag waist, unknowns the borderline", () => {
    expect(computeSizeFit({ ...base, labeledSize: "36x32" }, mUser).fit).toBe("mismatch");
    expect(computeSizeFit({ ...base, labeledSize: "34x32" }, mUser).fit).toBe("unknown");
  });

  it("is not_applicable when the user gave no waist", () => {
    const topOnly: UserSizeProfile = { topSize: "M", waistSize: null, pitToPitInches: null };
    expect(computeSizeFit({ ...base, waistInches: 44 }, topOnly).fit).toBe("not_applicable");
  });
});

describe("computeSizeFit — non-matchable garments", () => {
  it("skips footwear, accessories, and dresses", () => {
    for (const garmentType of ["footwear", "accessory", "dress", "other"]) {
      const { fit } = computeSizeFit(
        { garmentType, labeledSize: "10", pitToPitInches: null, waistInches: null, estimatedEra: null },
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
