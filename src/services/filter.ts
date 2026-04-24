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

export interface FilterOptions {
  minPrice?: number;
  maxPrice?: number;
}

export async function filterListings(listings: Listing[], options?: FilterOptions): Promise<Listing[]> {
  const minPrice = options?.minPrice ?? MIN_PRICE;
  const maxPrice = options?.maxPrice;

  const results = listings.filter((listing) => {
    const text = `${listing.title} ${listing.description}`.toLowerCase();

    if (listing.imageUrls.length < MIN_IMAGES) return false;
    if (listing.price < minPrice) return false;
    if (maxPrice != null && listing.price > maxPrice) return false;
    if (SKIP_KEYWORDS.some((kw) => text.includes(kw))) return false;
    if (listing.rawData.itemGroupType === "SELLER_DEFINED_VARIATIONS") return false;

    return true;
  });

  console.log(`Filter: ${results.length}/${listings.length} passed`);
  return results;
}
