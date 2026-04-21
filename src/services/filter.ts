import type { Listing } from "../types";

const SKIP_KEYWORDS = [
  "reproduction",
  "inspired by",
  "replica",
  "costume",
  "halloween",
  "cosplay",
  "faux",
  "lot of",
  "bundle",
  "wholesale",
  "mixed lot",
  "for parts",
  "fast fashion",
  "forever 21",
  "shein",
];

const MIN_PRICE = 10;
const MIN_IMAGES = 2;

export async function filterListings(listings: Listing[]): Promise<Listing[]> {
  const results = listings.filter((listing) => {
    const text = `${listing.title} ${listing.description}`.toLowerCase();

    // Need photos to visually authenticate
    if (listing.imageUrls.length < MIN_IMAGES) return false;

    // Skip obvious junk lots / near-free items
    if (listing.price < MIN_PRICE) return false;

    // Skip explicit non-vintage / non-authentic keywords
    if (SKIP_KEYWORDS.some((kw) => text.includes(kw))) return false;

    // Skip multi-variation listings — vintage is one-of-a-kind
    if (listing.rawData.itemGroupType === "SELLER_DEFINED_VARIATIONS") return false;

    return true;
  });

  console.log(`Filter: ${results.length}/${listings.length} passed`);
  return results;
}
