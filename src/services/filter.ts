import type { Listing } from "../types";

// Pass 1: Cheap/fast filtering rules
// These can be iterated on by reviewing stored FilteredListing records

const SKIP_KEYWORDS = [
  "reproduction",
  "inspired by",
  "replica",
  "new with tags",
  "nwt",
];

const MAX_PRICE = 500; // Skip if seller already pricing high

export async function filterListings(listings: Listing[]): Promise<Listing[]> {
  return listings.filter((listing) => {
    // Skip if no images
    if (listing.imageUrls.length === 0) {
      return false;
    }

    // Skip if price too high (seller likely knows value)
    if (listing.price > MAX_PRICE) {
      return false;
    }

    // Skip if contains exclusion keywords
    const text = `${listing.title} ${listing.description}`.toLowerCase();
    for (const keyword of SKIP_KEYWORDS) {
      if (text.includes(keyword)) {
        return false;
      }
    }

    // Skip multi-variation listings (multiple sizes/colors) — vintage is one-of-one
    if (listing.rawData.itemGroupType === "SELLER_DEFINED_VARIATIONS") {
      return false;
    }

    return true;
  });
}
