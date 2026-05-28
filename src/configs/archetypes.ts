import type { KeywordConfig } from "./digests";

export type ArchetypeId =
  | "americana"
  | "ivy"
  | "military"
  | "european-workwear"
  | "cowboy"
  | "biker"
  | "reggae"
  | "british-mod"
  | "sportswear";

export const ARCHETYPE_IDS: readonly ArchetypeId[] = [
  "americana",
  "ivy",
  "military",
  "european-workwear",
  "cowboy",
  "biker",
  "reggae",
  "british-mod",
  "sportswear",
];

export interface Archetype {
  id: ArchetypeId;
  label: string;
  keywords: KeywordConfig[];
  /** Appended to the Gemini identification prompt via the promptAppend parameter. */
  promptContext: string;
  /** Injected into the personalization scoring prompt as the aesthetic frame for this user. */
  scoringContext: string;
}

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  americana: {
    id: "americana",
    label: "Americana",
    keywords: [
      { query: "vintage chore coat", percentage: 0.25 },
      { query: "vintage work jacket", percentage: 0.22 },
      { query: "vintage denim jacket", percentage: 0.20 },
      { query: "vintage flannel shirt", percentage: 0.18 },
      { query: "vintage workwear", percentage: 0.15 },
    ],
    promptContext: `This item will be shown to a collector who specializes in American heritage workwear and Americana. Pay particular attention to:
- Union labels (ILGWU, ACWA, UGWA), country of origin tags, and lot/style numbers that confirm domestic manufacture
- Selvedge denim construction, chain stitch hems, and blanket-lined interiors
- Era markers specific to American workwear: bar-tack reinforcement, cinch backs, pleated fronts, and domed snaps
- Brands with genuine American manufacturing provenance: Carhartt, Big Mac, Key Imperial, Oshkosh B'Gosh, Boss of the Road

In the styleGuide field, speak to how this fits into a rugged, utilitarian Americana wardrobe — raw denim, broken-in boots, chamois shirts. Who wears this naturally?`,
    scoringContext: `The user collects American heritage workwear and Americana. Their taste centers on domestically manufactured pieces with visible construction provenance — union labels, selvedge construction, chain stitch, blanket lining. They value authentic work-wear silhouettes (chore coats, engineer jackets, bibs) and brands like Carhartt, Key, Oshkosh, and Big Mac. Score items highly if they have strong American manufacturing markers; score low for reproductions or items without clear provenance.`,
  },

  ivy: {
    id: "ivy",
    label: "Ivy League / Prep",
    keywords: [
      { query: "vintage oxford shirt", percentage: 0.33 },
      { query: "vintage tweed jacket", percentage: 0.29 },
      { query: "vintage crewneck sweater", percentage: 0.38 },
    ],
    promptContext: `This item will be shown to a collector focused on Ivy League and traditional American prep style. Pay particular attention to:
- Natural-shoulder construction, sack silhouette, and 3/2-roll lapels on jackets
- Oxford cloth button-downs with the specific collar roll that defines the style
- Harris Tweed labels, Shetland wool content, and Scottish mill provenance
- Makers marks from canonical Ivy suppliers: Brooks Brothers, J. Press, Chipp, Southwick, Kingsridge
- Details that signal provenance: patch pockets, back vent style, horn buttons, madder ties

In the styleGuide field, speak to how this fits into a trad wardrobe — khakis, white bucks, rep ties. Who pulls this off without looking costumed?`,
    scoringContext: `The user collects Ivy League and traditional American prep clothing. They look for natural-shoulder construction, sack-cut jackets with 3/2-roll lapels, authentic Oxford cloth button-downs with proper collar roll, and genuine Shetland or Harris Tweed knitwear. Canonical brands matter: Brooks Brothers, J. Press, Chipp, Southwick. Score highly for pieces with strong trad provenance and construction markers; score low for anything that leans toward fashion-Ivy without roots in the actual tradition.`,
  },

  military: {
    id: "military",
    label: "Military Surplus",
    keywords: [
      { query: "vintage military jacket", percentage: 0.30 },
      { query: "vintage field jacket", percentage: 0.25 },
      { query: "vintage flight jacket", percentage: 0.22 },
      { query: "vintage military fatigue", percentage: 0.13 },
      { query: "vintage deck jacket", percentage: 0.10 },
    ],
    promptContext: `This item will be shown to a collector who specializes in authentic US military surplus and vintage government-issue clothing. Pay particular attention to:
- Contract tags: manufacturer name, contract number (DSA/DLA prefix), date of manufacture, and size
- Construction details that authenticate military issue: nylon shell vs cotton sateen, Alpha Industries vs Dobbs, correct zipper type (Talon, Crown) by era
- Correct hardware for the garment type: M-65 field jacket should have correct label and liner snap-ins; MA-1 should have orange lining, correct ribbing
- Alpha Industries, Schott, Spiewak, Dobbs, and other contract manufacturers
- Distinguishing genuine government issue from civilian reproductions (different label placement, hardware, construction)

In the styleGuide field, speak to how the piece is worn today — the gap between workwear overlap and streetwear. Who wears this well?`,
    scoringContext: `The user collects authentic US military surplus clothing — government-issue jackets, field gear, flight jackets. They prioritize contract authenticity: correct contract tags (DSA/DLA numbers), accurate hardware for the era, correct lining colors, and recognized contract manufacturers (Alpha Industries, Schott, Spiewak). They can spot a civilian reproduction immediately. Score highly for well-documented government-issue pieces with readable contract tags; score low for civilian repros or pieces with missing/unclear provenance.`,
  },

  "european-workwear": {
    id: "european-workwear",
    label: "European Workwear",
    keywords: [
      { query: "vintage chore coat", percentage: 0.28 },
      { query: "french work jacket", percentage: 0.25 },
      { query: "vintage work jacket", percentage: 0.20 },
      { query: "vintage HBT jacket", percentage: 0.15 },
      { query: "vintage moleskin jacket", percentage: 0.12 },
    ],
    promptContext: `This item will be shown to a collector who specializes in European — especially French and British — vintage workwear. Pay particular attention to:
- French manufacture markers: "Fabriqué en France" tags, typical French sizing (38, 40, 42 in jacket), loom-woven cotton twill or moleskin fabric
- Bleu de travail construction: the specific indigo-dyed herringbone cotton twill, button type, and pocket configuration of authentic French work jackets
- HBT (herringbone twill) fabric in the correct weight and weave for the era
- British workwear elements: Millerain waxed cotton, Barbour-style construction, British manufacturing labels
- Deadstock vs heavily worn patina — both are valued differently

In the styleGuide field, speak to the minimalist, utilitarian aesthetic — how European workwear sits in a wardrobe oriented toward clean silhouettes, natural fabrics, and quiet authenticity.`,
    scoringContext: `The user collects European vintage workwear, with a focus on French and British pieces. They value authentic bleu de travail (French indigo herringbone twill), genuine moleskin jackets, and pieces with clear European manufacturing provenance. They are drawn to minimalist, utilitarian silhouettes — chore coats, bakers jackets, herringbone work trousers — with natural fabric content and visible wear patina. Score highly for pieces with clear French or British manufacturing marks and authentic workwear construction; score low for items without provenance or that feel fashion-influenced rather than genuinely utilitarian.`,
  },

  cowboy: {
    id: "cowboy",
    label: "Western / Cowboy",
    keywords: [
      { query: "vintage western shirt", percentage: 0.30 },
      { query: "vintage pearl snap shirt", percentage: 0.25 },
      { query: "vintage rodeo shirt", percentage: 0.20 },
      { query: "vintage cowboy shirt", percentage: 0.15 },
      { query: "vintage western jacket", percentage: 0.10 },
    ],
    promptContext: `This item will be shown to a collector focused on authentic American western wear. Pay particular attention to:
- Pearl snap construction: the specific snap brand (Scovill, Gripper, etc.) and placement authentic to vintage western shirts
- Embroidery quality and motifs on rodeo shirts and jackets: chain stitch vs flat embroidery, cactus/flower/eagle motifs, yoke shape
- Brand authentication for western wear: Rockmount, H Bar C, Karman, Panhandle Slim, Wrangler 936 cut
- Sawtooth pockets, contrast piping, and other construction details that define authentic western shirts
- Nudie Cohn / Nathan Turk custom work vs production rodeo shirts — both are valued differently

In the styleGuide field, speak honestly to who wears vintage western wear today — the overlap between genuine cowboy aesthetic and the fashion-forward take on it.`,
    scoringContext: `The user collects authentic American western wear — rodeo embroidered shirts, pearl snap westerns, and vintage cowboy jackets. They prioritize construction authenticity: correct snap hardware, chain-stitch embroidery, sawtooth pockets, and piping typical of the era. Recognized brands matter: Rockmount, H Bar C, Karman, Panhandle Slim, Wrangler 936. Score highly for pieces with strong western wear construction markers and brand provenance; score low for generic western-inspired clothing without authentic construction details.`,
  },

  biker: {
    id: "biker",
    label: "Biker / Moto",
    keywords: [
      { query: "vintage motorcycle jacket", percentage: 0.32 },
      { query: "vintage leather biker jacket", percentage: 0.28 },
      { query: "vintage cafe racer jacket", percentage: 0.20 },
      { query: "vintage moto jacket", percentage: 0.12 },
      { query: "vintage riding jacket", percentage: 0.08 },
    ],
    promptContext: `This item will be shown to a collector who specializes in vintage motorcycle jackets and biker wear. Pay particular attention to:
- Leather type and grade: horsehide vs cowhide vs steerhide — horsehide is the most prized for its toughness and characteristic grain
- Hardware authentication: zipper brand (Talon, Conmar, Crown, Gripper Zipper) and era-correct placement; snap type and logo on Schott
- Schott Perfecto authentication markers: model number, era-specific label, hardware configuration
- Cafe racer vs asymmetric vs belted styles — the silhouette and zip placement tell you the function
- Belstaff waxed cotton provenance: British vs post-relocation manufacture, Millerain waxed cotton vs later substitutes
- Natural patina vs refinished leather — collectors strongly prefer original finish

In the styleGuide field, speak to how a vintage motorcycle jacket actually gets worn today — who wears it authentically and who's costuming.`,
    scoringContext: `The user collects vintage motorcycle jackets and biker wear. They are serious about leather quality — horsehide is most desirable, followed by steerhide; they can identify the hide from photos. Hardware is critical: they look for Talon or Conmar zippers, era-correct snap placement, and authentic Schott label configurations. They strongly prefer original leather finish over refinished pieces. Score highly for horsehide pieces with authenticated hardware and readable labels; score lower for cowhide reproductions or pieces with refinished leather or replaced hardware.`,
  },

  reggae: {
    id: "reggae",
    label: "Reggae / Rude Boy / Ska",
    keywords: [
      { query: "vintage porkpie hat", percentage: 0.25 },
      { query: "vintage jamaican shirt", percentage: 0.22 },
      { query: "vintage tropical shirt", percentage: 0.20 },
      { query: "vintage ska suit", percentage: 0.18 },
      { query: "vintage tonic suit", percentage: 0.15 },
    ],
    promptContext: `This item will be shown to a collector focused on vintage reggae, ska, and rude boy style — the fashion of Jamaica's Kingston scene, the British ska revival, and related subcultures. Pay particular attention to:
- Porkpie hat construction and provenance — the silhouette, brim width, and material
- Jamaican tropical shirts: the specific patterns, color palettes, and rayon or cotton construction of authentic island-made pieces
- British mod and ska revival crossover: Harrington jackets, sta-prest trousers, tonic suits
- Rude boy style markers: sharp tailoring in tropical-weight fabrics, two-tone shoes, slim-cut silhouettes
- Items with connections to specific sound system culture, Jamaican tourism labels, or British ska revival (2Tone records era, late 1970s–early 1980s)

In the styleGuide field, speak to the sharp, cool, understated nature of this aesthetic — a style built on contrast and precision.`,
    scoringContext: `The user collects vintage clothing connected to reggae, ska, and rude boy culture — Jamaican tropical shirts, porkpie hats, sharp British tailoring from the ska revival era, and 2Tone-adjacent pieces. They value items with genuine cultural connection to Kingston's sound system scene or the British ska revival of the late 1970s and early 1980s. Score highly for pieces with authentic cultural provenance — Jamaican-made shirts, era-correct rude boy tailoring, ska revival items; score lower for generic items without a clear connection to these specific subcultures.`,
  },

  "british-mod": {
    id: "british-mod",
    label: "British Mod",
    keywords: [
      { query: "vintage harrington jacket", percentage: 0.28 },
      { query: "vintage mod suit", percentage: 0.22 },
      { query: "vintage 60s slim suit", percentage: 0.20 },
      { query: "vintage mod polo shirt", percentage: 0.18 },
      { query: "vintage sta-prest trousers", percentage: 0.12 },
    ],
    promptContext: `This item will be shown to a collector focused on British mod style — the original 1960s London scene and its various revivals. Pay particular attention to:
- Harrington jacket provenance: Baracuta G9 vs alternatives, British vs later manufacture, correct tartan lining, era-specific label
- Fred Perry authentication: laurel wreath logo evolution by era, British vs Egyptian cotton, correct collar and cuff ribbing
- Ben Sherman: British manufacture marks, button-down collar construction, the specific gingham and check patterns of the original mod era
- 1960s British tailoring: slim lapels, ticket pockets, half-canvas construction, British manufacturing labels
- Madness, The Jam, The Who — items with connection to the mod revival are valued by this collector

In the styleGuide field, speak to the specific mod aesthetic — slim and precise, built around movement and subcultural clarity. Who wears this in a way that feels lived-in rather than costume?`,
    scoringContext: `The user collects British mod clothing — Harrington jackets (especially Baracuta G9), vintage Fred Perry polos, Ben Sherman shirts, and slim 1960s British tailoring. They are precise about provenance: British manufacture marks matter, as does the specific label evolution of Fred Perry and Baracuta across eras. They value items connected to the original 1960s mod scene and the late 1970s/early 1980s mod revival. Score highly for authenticated British-made pieces with clear era markers; score low for non-British manufacture, later reproductions, or items that gesture at mod style without genuine subcultural roots.`,
  },

  sportswear: {
    id: "sportswear",
    label: "Vintage Sportswear",
    keywords: [
      { query: "vintage track jacket", percentage: 0.28 },
      { query: "vintage windbreaker", percentage: 0.22 },
      { query: "vintage sweatshirt", percentage: 0.20 },
      { query: "vintage warm up suit", percentage: 0.18 },
      { query: "vintage athletic jacket", percentage: 0.12 },
    ],
    promptContext: `This item will be shown to a collector who specializes in vintage American and European sportswear — athletic brand heritage pieces from the 1970s through the early 1990s. Pay particular attention to:
- Champion reverse weave authentication: the specific reverse-weave construction (horizontal ribs on the torso), era-correct "C" logo, bar tag, and union label
- Nike era markers: pre-1985 blue tag vs later orange tag vs white tag, "Made in USA" vs offshore manufacture, Swoosh style evolution
- Adidas trefoil vs performance logo — the trefoil indicates heritage lifestyle product; note three-stripe placement and country of manufacture
- Starter jacket construction: the specific nylon material, team licensing, era-correct tags, and correct zip-off or snap-front configuration
- Team licensing marks and year-specific style codes that collectors use to date pieces

In the styleGuide field, speak honestly to how vintage sportswear fits into current fashion — the line between authentic collector piece and throwback styling.`,
    scoringContext: `The user collects vintage sportswear from the golden era of athletic brands — Champion reverse weave, vintage Nike (pre-1990s), trefoil Adidas, and Starter jackets. They are knowledgeable about authentication: Champion bar tags and reverse-weave construction, Nike tag era color codes, Adidas trefoil vs stripe placement, Starter licensing marks. They prize USA-made pieces and items with clear era markers. Score highly for authenticated vintage sportswear with readable brand provenance from the 1970s–1990s; score low for anything from the performance-logo era or post-1995 manufacture without strong collector appeal.`,
  },
};

/**
 * Returns a stable, sorted configId string for a given set of archetype IDs.
 * Used as the Story.configId so per-archetype-combination stories are cached correctly.
 *
 * Examples:
 *   buildArchetypeConfigId([])               → "en-default"
 *   buildArchetypeConfigId(["americana"])     → "americana"
 *   buildArchetypeConfigId(["ivy","biker"])   → "biker+ivy"  (sorted)
 */
export function buildArchetypeConfigId(archetypeIds: ArchetypeId[]): string {
  // "en-default" is a misnomer — it means "no archetypes" not "English language".
  // Language is stored separately on Story. Renaming requires a prod DB migration
  // (UPDATE "Story" SET "configId" = 'default' WHERE "configId" = 'en-default')
  // plus updating the schema default. Not worth the risk until there's a real need.
  if (archetypeIds.length === 0) return "en-default";
  return [...archetypeIds].sort().join("+");
}

/**
 * Merges keywords from multiple archetypes into a single deduplicated list.
 *
 * When two archetypes share the same query string, their weights are averaged
 * (rather than summed) so the merge stays proportional. The final list is
 * renormalized to sum exactly to 1.0.
 *
 * Falls back to DEFAULT_KEYWORDS if archetypeIds is empty or all invalid.
 */
import { DEFAULT_KEYWORDS } from "./digests";

export function mergeArchetypeKeywords(archetypeIds: ArchetypeId[]): KeywordConfig[] {
  if (archetypeIds.length === 0) return DEFAULT_KEYWORDS;

  // Collect (query → accumulated weight, contribution count)
  const accumulator = new Map<string, { total: number; count: number }>();

  for (const id of archetypeIds) {
    const archetype = ARCHETYPES[id];
    if (!archetype) continue;
    for (const kw of archetype.keywords) {
      const existing = accumulator.get(kw.query);
      if (existing) {
        existing.total += kw.percentage;
        existing.count += 1;
      } else {
        accumulator.set(kw.query, { total: kw.percentage, count: 1 });
      }
    }
  }

  if (accumulator.size === 0) return DEFAULT_KEYWORDS;

  // Average the weight for each query (so shared queries don't dominate),
  // then renormalize so all percentages sum to 1.0.
  const raw: KeywordConfig[] = [];
  for (const [query, { total, count }] of accumulator) {
    raw.push({ query, percentage: total / count });
  }

  const sum = raw.reduce((s, kw) => s + kw.percentage, 0);
  return raw.map((kw) => ({ query: kw.query, percentage: kw.percentage / sum }));
}

/**
 * Builds a combined promptContext string for use as promptAppend in runIdentification().
 * Returns undefined when no archetypes are selected (falls through to default behaviour).
 */
export function buildArchetypePromptAppend(archetypeIds: ArchetypeId[]): string | undefined {
  if (archetypeIds.length === 0) return undefined;
  const parts = archetypeIds
    .map((id) => ARCHETYPES[id]?.promptContext)
    .filter(Boolean) as string[];
  return parts.length > 0 ? parts.join("\n\n---\n\n") : undefined;
}

/**
 * Builds a combined scoringContext string for injection into personalization prompts.
 * Returns undefined when no archetypes are selected.
 */
export function buildArchetypeScoringContext(archetypeIds: ArchetypeId[]): string | undefined {
  if (archetypeIds.length === 0) return undefined;
  const parts = archetypeIds
    .map((id) => ARCHETYPES[id]?.scoringContext)
    .filter(Boolean) as string[];
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/** Type guard: returns true iff s is a valid ArchetypeId slug. */
export function isValidArchetypeId(s: string): s is ArchetypeId {
  return (ARCHETYPE_IDS as readonly string[]).includes(s);
}
