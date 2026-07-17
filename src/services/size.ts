// Size extraction resolution + user↔garment fit matching.
//
// Two independent extraction processes, each with a photo channel and a text
// channel:
//   TAG          — the size label (photo of the tag / stated in text)
//   MEASUREMENT  — real measured dimensions (tape photo / stated in text)
//
// Text channels are corroborated against the listing text (quote/regex) —
// higher anti-hallucination confidence than photo reads. Each process
// reconciles its two channels; if they contradict, the process aborts.
// Finally the confirmed tag and confirmed measurement are cross-checked
// against each other via the size chart; if they disagree, sizing is
// discarded entirely. Whatever survives is confirmed — it can hard-exclude.
// Anything else is "unknown" and only draws a score penalty.
//
// Everything converges on one currency: inches. Flat pit-to-pit for tops,
// tag waist (circumference) for bottoms. Matching is interval arithmetic,
// so every behavior knob is a named constant here.
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

// Raw sizing block from Gemini identification — four channels, unvalidated.
export interface RawSizeExtraction {
  garmentType?: string | null;
  tagFromPhoto?: string | null;        // size printed on a tag visible in photos
  tagFromText?: string | null;         // size stated in title/description/specifics
  tagTextQuote?: string | null;        // exact text the tag was read from
  photoPitToPitInches?: number | null; // read off a tape measure in a photo
  photoWaistInches?: number | null;
  textPitToPitInches?: number | null;  // stated in the listing text
  textWaistInches?: number | null;
  textMeasurementQuote?: string | null;
}

// How the final size was arrived at — persisted as Evaluation.sizeEvidence.
export type SizeResolution =
  | "tag+measurement" // both processes confirmed and agree
  | "tag"             // only a confirmed tag
  | "measurement"     // only a confirmed measurement
  | "contradicted"    // channels or processes disagreed — sizing discarded
  | "none";           // no size information found

// Resolved + confirmed sizing — this is what Evaluation persists.
export interface GarmentSize {
  garmentType: GarmentType;
  labeledSize: string | null;
  pitToPitInches: number | null;
  waistInches: number | null;
  resolution: SizeResolution;
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

// Outerwear is cut to layer over other clothing — accept that much extra room
// on measured garments. (Labels are size-distance matched instead.)
const OUTERWEAR_EXTRA_ROOM = 1.25;

// Pre-1990s labels run ~1 size small relative to the modern chart.
const VINTAGE_LABEL_SHIFT = -1;
const VINTAGE_WAIST_SHIFT = -1;

// Widening applied to chart ranges in labelToPitToPitRange (used by the
// tag-vs-measurement agreement check).
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

// Photo channel vs text channel of the same measurement must agree this
// closely, else the measurement process aborts.
const CHANNEL_AGREEMENT = 1;

// Confirmed measurement must land within the confirmed tag's chart range
// (vintage-shifted) extended by this slack, else sizing is discarded.
const TAG_MEASUREMENT_SLACK = 2;
const WAIST_TAG_MEASUREMENT_SLACK = 2;

// Plausible extracted values; anything outside gets unit-coerced or dropped.
const P2P_PLAUSIBLE: Range = { lo: 14, hi: 32 };
const WAIST_PLAUSIBLE: Range = { lo: 24, hi: 50 };

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
  const s = label.toUpperCase().replace(/[.\-_]/g, " ").replace(/\s+/g, " ").trim();
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

/**
 * Parse a waist number out of a bottoms label: "32x30", "W32 L30", "32".
 * The waist must lead the label (or follow a W) — this avoids reading the
 * length as waist in juniors sizing like "4x32".
 */
export function parseWaistLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.match(/(?:^\s*|\bw\s*)(\d{2})(?:\s*[x×]\s*\d{2})?\b/i);
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

// ─── Text corroboration ──────────────────────────────────────────────────────

const VALID_GARMENT_TYPES: ReadonlySet<string> = new Set<GarmentType>([
  "top", "outerwear", "bottom", "dress", "footwear", "accessory", "other",
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
  const q = normalizeText(quote);
  if (q.length < 4 || !normalizeText(text).includes(q)) return false;
  for (const match of quote.matchAll(/\d{2,3}(?:[.,]\d)?/g)) {
    if (numberMatchesReported(match[0], reportedInches)) return true;
  }
  return false;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
}

/**
 * Does the listing text actually state this tag size? Token-based so "XL"
 * doesn't false-positive inside "XXL". Letter sizes match any synonym token
 * ("X-Large", "XL"); waist labels match the waist number.
 */
export function textContainsLabel(text: string, label: string): boolean {
  const normLabel = normalizeText(label);
  if (normLabel.length === 0) return false;
  const normText = ` ${normalizeText(text)} `;
  if (normLabel.length >= 2 && normText.includes(` ${normLabel} `)) return true;

  const labelSize = parseTopSizeLabel(label);
  if (labelSize) {
    const tokens = normText.trim().split(" ");
    for (let i = 0; i < tokens.length; i++) {
      if (parseTopSizeLabel(tokens[i]) === labelSize) return true;
      if (i + 1 < tokens.length && parseTopSizeLabel(`${tokens[i]} ${tokens[i + 1]}`) === labelSize) return true;
    }
    return false;
  }

  const waist = parseWaistLabel(label);
  if (waist != null) return new RegExp(`\\b${waist}\\b`).test(text);
  return false;
}

// ─── Resolution: raw four-channel extraction → confirmed GarmentSize ─────────

interface ResolvedTag {
  label: string | null;
  contradicted: boolean;
}

/** Two labels agree when they parse to the same size (or same waist). */
function labelsAgree(a: string, b: string): boolean {
  const ai = topSizeIndex(a);
  const bi = topSizeIndex(b);
  if (ai != null && bi != null) return ai === bi;
  const aw = parseWaistLabel(a);
  const bw = parseWaistLabel(b);
  if (aw != null && bw != null) return aw === bw;
  return normalizeText(a) === normalizeText(b);
}

/**
 * TAG process: reconcile the photo and text channels.
 * The text channel must be corroborated (the label actually appears in the
 * listing text). Photo and corroborated text contradicting → abort.
 */
export function resolveTag(raw: RawSizeExtraction, listingText: string): ResolvedTag {
  const photo = raw.tagFromPhoto?.trim() || null;
  let text = raw.tagFromText?.trim() || null;
  if (text && !textContainsLabel(listingText, text)) text = null;

  if (photo && text) {
    if (labelsAgree(photo, text)) return { label: text, contradicted: false };
    return { label: null, contradicted: true };
  }
  return { label: text ?? photo, contradicted: false };
}

interface ResolvedMeasurement {
  pitToPit: number | null;
  waist: number | null;
  contradicted: boolean;
}

/**
 * MEASUREMENT process: reconcile photo and text channels per dimension.
 * Text values must be corroborated (quote or measurement-context regex).
 * Channels contradicting on any dimension → abort the whole process.
 */
export function resolveMeasurement(raw: RawSizeExtraction, listingText: string): ResolvedMeasurement {
  const corroborated = (value: number): boolean =>
    quoteSupportsMeasurement(raw.textMeasurementQuote, listingText, value) ||
    descriptionSupportsMeasurement(listingText, value);

  const resolveDimension = (
    photoRaw: number | null | undefined,
    textRaw: number | null | undefined,
    coerce: (v: number | null | undefined) => number | null,
  ): { value: number | null; contradicted: boolean } => {
    const photo = coerce(photoRaw);
    let text = coerce(textRaw);
    if (text != null && !corroborated(text)) text = null;
    if (photo != null && text != null) {
      if (Math.abs(photo - text) <= CHANNEL_AGREEMENT) return { value: text, contradicted: false };
      return { value: null, contradicted: true };
    }
    return { value: text ?? photo, contradicted: false };
  };

  const p2p = resolveDimension(raw.photoPitToPitInches, raw.textPitToPitInches, coercePitToPitInches);
  const waist = resolveDimension(raw.photoWaistInches, raw.textWaistInches, coerceWaistInches);

  if (p2p.contradicted || waist.contradicted) {
    return { pitToPit: null, waist: null, contradicted: true };
  }
  return { pitToPit: p2p.value, waist: waist.value, contradicted: false };
}

/** Does the confirmed measurement agree with the confirmed tag (chart-based)? */
function tagAgreesWithMeasurement(
  label: string,
  measurement: ResolvedMeasurement,
  era: string | null,
): boolean {
  if (measurement.pitToPit != null) {
    const range = labelToPitToPitRange(label, era);
    if (range && (
      measurement.pitToPit < range.lo - TAG_MEASUREMENT_SLACK ||
      measurement.pitToPit > range.hi + TAG_MEASUREMENT_SLACK
    )) return false;
  }
  if (measurement.waist != null) {
    const tagWaist = parseWaistLabel(label);
    if (tagWaist != null) {
      const adjusted = tagWaist + (isVintageEra(era) ? VINTAGE_WAIST_SHIFT : 0);
      if (Math.abs(adjusted - measurement.waist) > WAIST_TAG_MEASUREMENT_SLACK) return false;
    }
  }
  return true;
}

/**
 * Resolve Gemini's raw four-channel sizing block into a confirmed GarmentSize.
 * Any contradiction — between channels of a process, or between the two
 * processes — discards sizing entirely (resolution: "contradicted") so the
 * item takes the unknown-penalty path instead of matching on suspect data.
 */
export function resolveGarmentSize(
  raw: RawSizeExtraction | null | undefined,
  listingText: string,
  era: string | null,
): GarmentSize {
  const garmentType = (
    raw?.garmentType && VALID_GARMENT_TYPES.has(raw.garmentType) ? raw.garmentType : "other"
  ) as GarmentType;

  const discarded = (resolution: SizeResolution): GarmentSize => ({
    garmentType, labeledSize: null, pitToPitInches: null, waistInches: null, resolution,
  });
  if (!raw) return discarded("none");

  const tag = resolveTag(raw, listingText);
  const measurement = resolveMeasurement(raw, listingText);
  if (tag.contradicted || measurement.contradicted) return discarded("contradicted");

  const hasMeasurement = measurement.pitToPit != null || measurement.waist != null;
  if (tag.label && hasMeasurement && !tagAgreesWithMeasurement(tag.label, measurement, era)) {
    return discarded("contradicted");
  }

  const resolution: SizeResolution =
    tag.label && hasMeasurement ? "tag+measurement"
    : tag.label ? "tag"
    : hasMeasurement ? "measurement"
    : "none";

  return {
    garmentType,
    labeledSize: tag.label,
    pitToPitInches: measurement.pitToPit,
    waistInches: measurement.waist,
    resolution,
  };
}

// ─── Label → interval conversion ─────────────────────────────────────────────

/**
 * Convert a top label to an estimated flat pit-to-pit interval.
 * Applies the vintage shift when the era is pre-1990s and widens by
 * LABEL_UNCERTAINTY. Used by the tag-vs-measurement agreement check.
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

/** The user's chart index for label-distance matching (from topSize or their p2p). */
function userTopSizeIndex(user: UserSizeProfile): number | null {
  if (user.topSize) {
    const size = parseTopSizeLabel(user.topSize);
    if (size) return TOP_SIZES.indexOf(size);
  }
  if (user.pitToPitInches != null) return nearestSizeIndex(user.pitToPitInches);
  return null;
}

// Sizing that reaches these functions is confirmed (resolution above), so a
// clear miss is a confident mismatch — no confidence gating.
function fitPoint(value: number, band: Range, what: string): SizeFitResult {
  if (within(value, band)) {
    return { fit: "match", detail: `${what} ${value}" within [${band.lo}, ${band.hi}]` };
  }
  return { fit: "mismatch", detail: `${what} ${value}" outside [${band.lo}, ${band.hi}]` };
}

/**
 * Tags are trusted as labels: match within ±LABEL_MATCH_DISTANCE sizes of the
 * user (after the vintage shift), confident mismatch beyond.
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
    estimatedEra: string | null;
  },
  user: UserSizeProfile,
): SizeFitResult {
  const garmentType = (
    garment.garmentType && VALID_GARMENT_TYPES.has(garment.garmentType)
      ? garment.garmentType
      : "other"
  ) as GarmentType;

  if (garmentType === "top" || garmentType === "outerwear") {
    const band = userTopBand(user, garmentType);
    if (!band) return { fit: "not_applicable", detail: "user has no top size" };

    if (garment.pitToPitInches != null) {
      return fitPoint(garment.pitToPitInches, band, "pit-to-pit");
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
    if (user.waistSize == null) return { fit: "not_applicable", detail: "user has no waist size" };
    const band: Range = {
      lo: user.waistSize - WAIST_TOLERANCE.below,
      hi: user.waistSize + WAIST_TOLERANCE.above,
    };

    if (garment.waistInches != null) {
      return fitPoint(garment.waistInches, band, "waist");
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
