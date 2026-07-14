// Size extraction normalization + user↔garment fit matching.
//
// Everything converges on one currency: inches. Flat pit-to-pit for tops,
// tag waist (circumference) for bottoms. Labels ("M", "32x30") convert to
// intervals via the chart below; measurements are points. Matching is
// interval arithmetic, so every behavior knob is a named constant here.
//
// Men's/unisex sizing only by design — women's vintage sizing drifted too
// much by decade to chart reliably; those items fall through as "unknown".

export type GarmentType =
  | "top"
  | "outerwear"
  | "bottom"
  | "dress"
  | "footwear"
  | "accessory"
  | "other";

export type SizeEvidenceType =
  | "tape_photo"        // measurement read off a tape measure in a photo
  | "description_text"  // measurement stated in the listing text
  | "seller_specifics"  // structured eBay item specifics
  | "tag_only"          // only a label size is known — no real measurement
  | "none";

// Raw sizing block from Gemini identification — unvalidated, may be partial.
export interface RawSizeExtraction {
  garmentType?: string | null;
  labeledSize?: string | null;
  pitToPitInches?: number | null;
  waistInches?: number | null;
  evidenceType?: string | null;
  evidenceQuote?: string | null;
}

// Validated + confidence-scored sizing — this is what Evaluation persists.
export interface GarmentSize {
  garmentType: GarmentType;
  labeledSize: string | null;
  pitToPitInches: number | null;
  waistInches: number | null;
  sizeConfidence: number;
  sizeEvidence: SizeEvidenceType;
}

export interface UserSizeProfile {
  topSize: string | null;        // "XS".."XXL"
  waistSize: number | null;      // tag waist, inches
  pitToPitInches: number | null; // optional refinement — overrides topSize
}

// not_applicable = we can't or shouldn't judge (no user dims for this garment
// type, footwear, etc.) — treated as neutral, unlike "unknown" which is
// "this garment's size couldn't be determined" and draws a score penalty.
export type SizeFit = "match" | "mismatch" | "unknown" | "not_applicable";

export interface SizeFitResult {
  fit: SizeFit;
  detail: string;
}

interface Range {
  lo: number;
  hi: number;
}

// ─── Chart & tuning constants (all inches) ──────────────────────────────────

const TOP_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export type TopSize = (typeof TOP_SIZES)[number];

// Flat pit-to-pit garment measurement per modern men's label size
// (≈ body chest + 2–4" ease, halved).
const TOP_SIZE_CHART: Record<TopSize, Range> = {
  XS: { lo: 16, hi: 17.5 },
  S: { lo: 18, hi: 19.5 },
  M: { lo: 20, hi: 21.5 },
  L: { lo: 22, hi: 23.5 },
  XL: { lo: 24, hi: 25.5 },
  XXL: { lo: 26, hi: 27.5 },
};

// Outerwear is cut to layer over other clothing — accept that much extra room.
const OUTERWEAR_EXTRA_ROOM = 1.25;

// Pre-1990s labels run ~1 size small relative to the modern chart.
const VINTAGE_LABEL_SHIFT = -1;
const VINTAGE_WAIST_SHIFT = -1;

// Widening applied to chart ranges in labelToPitToPitRange (used by the
// measurement-vs-label contradiction check).
const LABEL_UNCERTAINTY = 1;

// Label matching is by size distance — tags are discrete facts, not uncertain
// measurements. Within ±1 size of the user (vintage-adjusted) matches;
// 2+ sizes away is a confident mismatch.
const LABEL_MATCH_DISTANCE = 1;

// Bottoms tag waist (vintage-adjusted) vs user waist, in inches.
const WAIST_LABEL_MATCH = 1.5;    // |diff| ≤ → match
const WAIST_LABEL_MISMATCH = 3;   // |diff| ≥ → mismatch (between → unknown)

// Wear tolerance around the user's target — asymmetric because slightly
// bigger wears better than slightly smaller.
const TOP_TOLERANCE = { below: 1, above: 2 };
const WAIST_TOLERANCE = { below: 1, above: 1.5 };

// A user-entered or garment-measured point value still represents a garment
// that was measured by hand — allow this much slack around it.
const POINT_SLACK = 0.75;

// Score multiplier for candidates whose size couldn't be determined
// (same pattern as the era penalty in score.ts).
export const SIZE_UNKNOWN_PENALTY = 0.85;

// A measured mismatch only hard-excludes when the measurement survived
// corroboration. All verified evidence sources score ≥ 0.5; the
// label-contradiction cap (0.3) and legacy null rows (0) stay below —
// those degrade to "unknown" (penalty, never deletion).
const MISMATCH_MIN_CONFIDENCE = 0.5;

// Plausible extracted values; anything outside gets unit-coerced or dropped.
const P2P_PLAUSIBLE: Range = { lo: 14, hi: 32 };
const WAIST_PLAUSIBLE: Range = { lo: 24, hi: 50 };

// Base confidence per evidence source. Text-sourced measurements
// (description_text, seller_specifics) only reach these values after
// corroboration against the listing text — uncorroborated ones are discarded
// entirely (see normalizeSizeExtraction). tape_photo can't be text-verified.
const EVIDENCE_CONFIDENCE: Record<SizeEvidenceType, number> = {
  tape_photo: 0.7,
  description_text: 0.75,
  seller_specifics: 0.6,
  tag_only: 0.3,
  none: 0,
};

// ─── Small helpers ───────────────────────────────────────────────────────────

const within = (v: number, r: Range) => v >= r.lo && v <= r.hi;
const round1 = (v: number) => Math.round(v * 10) / 10;
const mid = (r: Range) => (r.lo + r.hi) / 2;

/**
 * Coerce a reported number into plausible inches. Tries, in order: as-is,
 * cm→in, circumference→flat (or flat→circumference for waist). Returns null
 * if no interpretation lands in the plausible range.
 */
export function coercePitToPitInches(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (within(value, P2P_PLAUSIBLE)) return round1(value);
  // cm first: bare 40–60s in vintage listings are usually cm pit-to-pit,
  // full chest circumference is normally spelled out ("chest 44").
  const fromCm = value / 2.54;
  if (within(fromCm, P2P_PLAUSIBLE)) return round1(fromCm);
  const fromCircumference = value / 2;
  if (within(fromCircumference, P2P_PLAUSIBLE)) return round1(fromCircumference);
  const fromCmCircumference = value / 2.54 / 2;
  if (within(fromCmCircumference, P2P_PLAUSIBLE)) return round1(fromCmCircumference);
  return null;
}

export function coerceWaistInches(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (within(value, WAIST_PLAUSIBLE)) return round1(value);
  const fromFlat = value * 2; // sellers sometimes give waist measured flat
  if (within(fromFlat, WAIST_PLAUSIBLE)) return round1(fromFlat);
  const fromCm = value / 2.54;
  if (within(fromCm, WAIST_PLAUSIBLE)) return round1(fromCm);
  return null;
}

/** Normalize a label string to a chart size: "Large", "l", "2XL", "X-Large"… */
export function parseTopSizeLabel(label: string | null | undefined): TopSize | null {
  if (!label) return null;
  const s = label.trim().toUpperCase().replace(/[.\-_]/g, " ").replace(/\s+/g, " ");
  const WORDS: Record<string, TopSize> = {
    "EXTRA SMALL": "XS", XSMALL: "XS", "X SMALL": "XS", XS: "XS",
    SMALL: "S", S: "S",
    MEDIUM: "M", MED: "M", M: "M",
    LARGE: "L", LG: "L", L: "L",
    "EXTRA LARGE": "XL", XLARGE: "XL", "X LARGE": "XL", XL: "XL",
    "2XL": "XXL", XXL: "XXL", "XX LARGE": "XXL", "2X": "XXL", "3XL": "XXL", XXXL: "XXL",
  };
  if (WORDS[s]) return WORDS[s];
  // Try each token ("Men's L" → "L", "L / 44" → "L")
  for (const token of s.split(/[\s/|,()]+/)) {
    if (WORDS[token]) return WORDS[token];
  }
  return null;
}

/** Chart index of a label (XS=0 … XXL=5); numeric chest/suit labels map via the chart. */
export function topSizeIndex(label: string | null | undefined): number | null {
  const size = parseTopSizeLabel(label);
  if (size) return TOP_SIZES.indexOf(size);
  if (!label) return null;
  const m = label.match(/\b(3[4-9]|4\d|5[0-4])\s*[RSL]?\b/);
  if (m) return nearestSizeIndex((parseInt(m[1], 10) + 3) / 2);
  return null;
}

function nearestSizeIndex(pitToPit: number): number {
  let best = 0;
  let bestDist = Infinity;
  TOP_SIZES.forEach((s, i) => {
    const d = Math.abs(mid(TOP_SIZE_CHART[s]) - pitToPit);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Parse a waist number out of a bottoms label: "32x30", "W32 L30", "32". */
export function parseWaistLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.match(/(?:w\s*)?(\d{2})(?:\s*[x×]\s*\d{2})?/i);
  if (!m) return null;
  const waist = parseInt(m[1], 10);
  return within(waist, WAIST_PLAUSIBLE) ? waist : null;
}

/** "1970s", "1960s-1970s", "late 80s" → true when clearly pre-1990. */
export function isVintageEra(era: string | null | undefined): boolean {
  if (!era) return false;
  const full = era.match(/\b(19|20)(\d)0s\b/);
  if (full) return full[1] === "19" && parseInt(full[2], 10) <= 8;
  const bare = era.match(/\b(\d)0s\b/); // "70s" → assume 1970s
  if (bare) return parseInt(bare[1], 10) <= 8;
  const year = era.match(/\b(19\d{2}|20\d{2})\b/);
  return year ? parseInt(year[1], 10) < 1990 : false;
}

// ─── Extraction normalization (listing side) ─────────────────────────────────

const VALID_GARMENT_TYPES: ReadonlySet<string> = new Set<GarmentType>([
  "top", "outerwear", "bottom", "dress", "footwear", "accessory", "other",
]);

const VALID_EVIDENCE: ReadonlySet<string> = new Set<SizeEvidenceType>([
  "tape_photo", "description_text", "seller_specifics", "tag_only", "none",
]);

// Numbers within a few words of a measurement keyword.
const MEASUREMENT_CONTEXT =
  /(?:pit\s*to\s*pit|p2p|ptp|armpit|chest|width|waist|身幅|着丈)\D{0,16}(\d{2,3}(?:[.,]\d)?)/gi;

/**
 * Deterministic cross-check: does the listing text actually contain a number
 * (near a measurement keyword) matching what Gemini reported? Guards against
 * hallucinated measurements.
 */
export function descriptionSupportsMeasurement(
  text: string,
  reportedInches: number,
): boolean {
  for (const match of text.matchAll(MEASUREMENT_CONTEXT)) {
    if (numberMatchesReported(match[1], reportedInches)) return true;
  }
  return false;
}

function numberMatchesReported(numberText: string, reportedInches: number): boolean {
  const value = parseFloat(numberText.replace(",", "."));
  if (!Number.isFinite(value)) return false;
  for (const candidate of [value, value / 2.54, value / 2, value * 2, value / 2.54 / 2]) {
    if (Math.abs(candidate - reportedInches) <= 0.75) return true;
  }
  return false;
}

/**
 * Strongest corroboration: the model's evidence quote must appear in the
 * listing text AND contain a number matching the reported measurement.
 * (The number requirement matters — quoting "Size: X-Large" while reporting
 * an invented 27" must not verify.)
 */
export function quoteSupportsMeasurement(
  quote: string | null | undefined,
  text: string,
  reportedInches: number,
): boolean {
  if (!quote) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
  const q = norm(quote);
  if (q.length < 4 || !norm(text).includes(q)) return false;
  for (const match of quote.matchAll(/\d{2,3}(?:[.,]\d)?/g)) {
    if (numberMatchesReported(match[0], reportedInches)) return true;
  }
  return false;
}

/**
 * Validate Gemini's raw sizing block into a persisted GarmentSize.
 * Confidence is derived here (evidence source + sanity checks),
 * never taken from the model.
 */
export function normalizeSizeExtraction(
  raw: RawSizeExtraction | null | undefined,
  listingText: string,
): GarmentSize {
  const garmentType = (
    raw?.garmentType && VALID_GARMENT_TYPES.has(raw.garmentType) ? raw.garmentType : "other"
  ) as GarmentType;
  const labeledSize = raw?.labeledSize?.trim() || null;
  let evidence = (
    raw?.evidenceType && VALID_EVIDENCE.has(raw.evidenceType) ? raw.evidenceType : "none"
  ) as SizeEvidenceType;

  let pitToPit = coercePitToPitInches(raw?.pitToPitInches);
  let waist = coerceWaistInches(raw?.waistInches);

  // tag_only means "no real measurement exists" — a measurement alongside it
  // is the model back-deriving inches from the label. Drop it; the chart
  // handles label conversion with proper uncertainty.
  if (evidence === "tag_only" || evidence === "none") {
    pitToPit = null;
    waist = null;
  }

  // Text-sourced measurements must be corroborated by the listing text: the
  // model's evidence quote (with a matching number) or a measurement-context
  // number. Uncorroborated ones are treated as invented and discarded — the
  // item falls back to its tag size rather than matching on fiction.
  if ((evidence === "description_text" || evidence === "seller_specifics") &&
      (pitToPit != null || waist != null)) {
    const reported = pitToPit ?? waist!;
    const corroborated =
      quoteSupportsMeasurement(raw?.evidenceQuote, listingText, reported) ||
      descriptionSupportsMeasurement(listingText, reported);
    if (!corroborated) {
      pitToPit = null;
      waist = null;
    }
  }

  const hasMeasurement = pitToPit != null || waist != null;
  if (!hasMeasurement) {
    evidence = labeledSize ? "tag_only" : "none";
    return {
      garmentType,
      labeledSize,
      pitToPitInches: null,
      waistInches: null,
      sizeConfidence: EVIDENCE_CONFIDENCE[evidence],
      sizeEvidence: evidence,
    };
  }

  let confidence = EVIDENCE_CONFIDENCE[evidence];

  // Label consistency: vintage running ~1 size small is expected; a gap of
  // several sizes means something was misread — degrade below the hard-exclude
  // threshold rather than confidently filter on bad data.
  const chartRange = labeledSize ? labelToPitToPitRange(labeledSize, null) : null;
  if (pitToPit != null && chartRange && Math.abs(pitToPit - mid(chartRange)) > 5) {
    confidence = Math.min(confidence, 0.3);
  }

  return {
    garmentType,
    labeledSize,
    pitToPitInches: pitToPit,
    waistInches: waist,
    sizeConfidence: Math.round(confidence * 100) / 100,
    sizeEvidence: evidence,
  };
}

// ─── Label → interval conversion ─────────────────────────────────────────────

/**
 * Convert a top label to an estimated flat pit-to-pit interval.
 * Applies the vintage shift when the era is pre-1990s and widens by
 * LABEL_UNCERTAINTY because we're guessing twice (label→chart→garment).
 */
export function labelToPitToPitRange(
  label: string,
  era: string | null,
): Range | null {
  let range: Range | null = null;

  const topSize = parseTopSizeLabel(label);
  if (topSize) {
    range = { ...TOP_SIZE_CHART[topSize] };
  } else {
    // Numeric chest/suit sizing ("42", "42R"): garment p2p ≈ (chest + ease)/2
    const m = label.match(/\b(3[4-9]|4\d|5[0-4])\s*[RSL]?\b/);
    if (m) {
      const p2p = (parseInt(m[1], 10) + 3) / 2;
      range = { lo: p2p - POINT_SLACK, hi: p2p + POINT_SLACK };
    }
  }
  if (!range) return null;

  if (isVintageEra(era)) {
    range = { lo: range.lo + VINTAGE_LABEL_SHIFT, hi: range.hi + VINTAGE_LABEL_SHIFT };
  }
  return { lo: range.lo - LABEL_UNCERTAINTY, hi: range.hi + LABEL_UNCERTAINTY };
}

// ─── Fit computation (per user, at ranking time) ─────────────────────────────

export function hasSizeProfile(user: UserSizeProfile): boolean {
  return user.topSize != null || user.waistSize != null || user.pitToPitInches != null;
}

/** The user's acceptable garment pit-to-pit band, or null if they gave no top size. */
function userTopBand(user: UserSizeProfile, garmentType: GarmentType): Range | null {
  let target: Range | null = null;
  if (user.pitToPitInches != null) {
    target = { lo: user.pitToPitInches - POINT_SLACK, hi: user.pitToPitInches + POINT_SLACK };
  } else if (user.topSize) {
    const size = parseTopSizeLabel(user.topSize);
    if (size) target = { ...TOP_SIZE_CHART[size] };
  }
  if (!target) return null;

  const extraRoom = garmentType === "outerwear" ? OUTERWEAR_EXTRA_ROOM : 0;
  return {
    lo: target.lo - TOP_TOLERANCE.below,
    hi: target.hi + TOP_TOLERANCE.above + extraRoom,
  };
}

function userWaistBand(user: UserSizeProfile): Range | null {
  if (user.waistSize == null) return null;
  return {
    lo: user.waistSize - WAIST_TOLERANCE.below,
    hi: user.waistSize + WAIST_TOLERANCE.above,
  };
}

/** The user's chart index for label-distance matching (from topSize or their p2p). */
function userTopSizeIndex(user: UserSizeProfile): number | null {
  if (user.topSize) {
    const size = parseTopSizeLabel(user.topSize);
    if (size) return TOP_SIZES.indexOf(size);
  }
  if (user.pitToPitInches != null) return nearestSizeIndex(user.pitToPitInches);
  return null;
}

function fitPoint(value: number, band: Range, confidence: number, what: string): SizeFitResult {
  if (within(value, band)) {
    return { fit: "match", detail: `${what} ${value}" within [${band.lo}, ${band.hi}]` };
  }
  if (confidence >= MISMATCH_MIN_CONFIDENCE) {
    return { fit: "mismatch", detail: `${what} ${value}" outside [${band.lo}, ${band.hi}]` };
  }
  return { fit: "unknown", detail: `${what} ${value}" outside band but low confidence (${confidence})` };
}

/**
 * Tags are trusted as labels: match within ±LABEL_MATCH_DISTANCE sizes of the
 * user (after the vintage shift), confident mismatch beyond. No confidence
 * involved — the only modeled uncertainty is vintage drift.
 */
function fitLabelDistance(
  garmentIndex: number,
  userIndex: number,
  label: string,
  vintage: boolean,
): SizeFitResult {
  const effective = garmentIndex - (vintage ? 1 : 0);
  const dist = Math.abs(effective - userIndex);
  const what = `label "${label}"${vintage ? " (vintage, runs one size small)" : ""}`;
  return dist <= LABEL_MATCH_DISTANCE
    ? { fit: "match", detail: `${what} within ${dist} size(s) of user` }
    : { fit: "mismatch", detail: `${what} is ${dist} sizes from user` };
}

/**
 * Judge a garment against a user's size profile.
 * Callers should treat "mismatch" as exclude, "unknown" as SIZE_UNKNOWN_PENALTY,
 * and "match"/"not_applicable" as neutral.
 */
export function computeSizeFit(
  garment: {
    garmentType: string | null;
    labeledSize: string | null;
    pitToPitInches: number | null;
    waistInches: number | null;
    sizeConfidence: number | null;
    estimatedEra: string | null;
  },
  user: UserSizeProfile,
): SizeFitResult {
  const garmentType = (
    garment.garmentType && VALID_GARMENT_TYPES.has(garment.garmentType)
      ? garment.garmentType
      : "other"
  ) as GarmentType;
  const confidence = garment.sizeConfidence ?? 0;

  if (garmentType === "top" || garmentType === "outerwear") {
    const band = userTopBand(user, garmentType);
    if (!band) return { fit: "not_applicable", detail: "user has no top size" };

    if (garment.pitToPitInches != null) {
      return fitPoint(garment.pitToPitInches, band, confidence, "pit-to-pit");
    }
    if (garment.labeledSize) {
      const garmentIndex = topSizeIndex(garment.labeledSize);
      const userIndex = userTopSizeIndex(user);
      if (garmentIndex != null && userIndex != null) {
        return fitLabelDistance(garmentIndex, userIndex, garment.labeledSize, isVintageEra(garment.estimatedEra));
      }
    }
    return { fit: "unknown", detail: "no size information on garment" };
  }

  if (garmentType === "bottom") {
    const band = userWaistBand(user);
    if (!band || user.waistSize == null) return { fit: "not_applicable", detail: "user has no waist size" };

    if (garment.waistInches != null) {
      return fitPoint(garment.waistInches, band, confidence, "waist");
    }
    const tagWaist = parseWaistLabel(garment.labeledSize);
    if (tagWaist != null) {
      const adjusted = tagWaist + (isVintageEra(garment.estimatedEra) ? VINTAGE_WAIST_SHIFT : 0);
      const diff = Math.abs(adjusted - user.waistSize);
      const what = `tag waist ${tagWaist}${adjusted !== tagWaist ? ` (vintage-adjusted ${adjusted})` : ""}`;
      if (diff <= WAIST_LABEL_MATCH) {
        return { fit: "match", detail: `${what} within ${diff}" of user ${user.waistSize}` };
      }
      if (diff >= WAIST_LABEL_MISMATCH) {
        return { fit: "mismatch", detail: `${what} is ${diff}" from user ${user.waistSize}` };
      }
      return { fit: "unknown", detail: `${what} borderline (${diff}" from user)` };
    }
    return { fit: "unknown", detail: "no size information on garment" };
  }

  // dress / footwear / accessory / other — no men's dimension to match against
  return { fit: "not_applicable", detail: `garment type "${garmentType}" not size-matched` };
}

// ─── Display helper (email) ──────────────────────────────────────────────────

/** Short human-readable size summary, or null when nothing is known. */
export function formatGarmentSize(garment: {
  labeledSize: string | null;
  pitToPitInches: number | null;
  waistInches: number | null;
}): string | null {
  const parts: string[] = [];
  if (garment.labeledSize) parts.push(`Tagged ${garment.labeledSize}`);
  if (garment.pitToPitInches != null) parts.push(`pit-to-pit ${garment.pitToPitInches}"`);
  if (garment.waistInches != null) parts.push(`waist ${garment.waistInches}"`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
