import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client";
import { fetchListings, type Platform } from "./services/ecommerce";
import { filterListings } from "./services/filter";
import { evaluateListing } from "./services/evaluate";
import { sendAlert } from "./services/notify";
import type { ScanConfig } from "./types";

const prisma = new PrismaClient();

const config: ScanConfig = {
  platform: "ebay",
  maxListings: 50,
  minMargin: 50,
  minConfidence: 0.7,
};

async function main() {
  console.log(`Starting vintage scan on ${config.platform}...`);

  // 1. Fetch listings from platform
  const listings = await fetchListings(config.platform, config.maxListings);
  console.log(`Fetched ${listings.length} listings from ${config.platform}`);

  // 2. Pass 1: Filter with cheap/fast rules
  const filtered = await filterListings(listings);
  console.log(`${filtered.length} listings passed initial filter`);

  // 3. Store filtered listings for future filter iteration
  for (const listing of filtered) {
    await prisma.filteredListing.upsert({
      where: { url: listing.url },
      update: {},
      create: {
        url: listing.url,
        platform: listing.platform,
        title: listing.title,
        price: listing.price,
        imageUrls: JSON.stringify(listing.imageUrls),
        description: listing.description,
        rawData: JSON.stringify(listing.rawData),
      },
    });
  }

  // 4. Pass 2: Evaluate with LLM (vision)
  const opportunities = [];
  for (const listing of filtered) {
    const dbListing = await prisma.filteredListing.findUnique({
      where: { url: listing.url },
    });
    if (!dbListing) continue;

    // Skip if already evaluated
    const existing = await prisma.evaluation.findUnique({
      where: { listingId: dbListing.id },
    });
    if (existing) continue;

    const evaluation = await evaluateListing(listing);

    const isOpportunity =
      evaluation.margin >= config.minMargin &&
      evaluation.confidence >= config.minConfidence;

    await prisma.evaluation.create({
      data: {
        listingId: dbListing.id,
        isAuthentic: evaluation.isAuthentic,
        estimatedEra: evaluation.estimatedEra,
        estimatedValue: evaluation.estimatedValue,
        currentPrice: evaluation.currentPrice,
        margin: evaluation.margin,
        confidence: evaluation.confidence,
        reasoning: evaluation.reasoning,
        redFlags: JSON.stringify(evaluation.redFlags),
        references: JSON.stringify(evaluation.references),
        isOpportunity,
      },
    });

    if (isOpportunity) {
      opportunities.push({ listing, evaluation });
    }
  }

  // 5. Send alerts for opportunities (separate from evaluation)
  if (opportunities.length > 0) {
    console.log(`Found ${opportunities.length} opportunities!`);
    await sendAlert(opportunities);
  } else {
    console.log("No opportunities found this run.");
  }

  console.log("Scan complete.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
