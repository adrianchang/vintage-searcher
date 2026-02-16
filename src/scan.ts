import { PrismaClient } from "./generated/prisma/client";
import { type Platform } from "./services/ecommerce";
import type { Listing, Evaluation, ScanConfig } from "./types";

export interface ScanDeps {
  prisma: PrismaClient;
  fetchListings: (platform: Platform, limit: number) => Promise<Listing[]>;
  filterListings: (listings: Listing[]) => Promise<Listing[]>;
  evaluateListing: (listing: Listing) => Promise<Evaluation>;
  sendAlert: (opportunities: { listing: Listing; evaluation: Evaluation }[]) => Promise<void>;
}

export async function runScan(config: ScanConfig, deps: ScanDeps) {
  const { prisma } = deps;

  console.log(`Starting vintage scan on ${config.platform}...`);

  // 1. Fetch listings from platform
  const listings = await deps.fetchListings(config.platform, config.maxListings);
  console.log(`Fetched ${listings.length} listings from ${config.platform}`);

  // 2. Pass 1: Filter with cheap/fast rules
  const filtered = await deps.filterListings(listings);
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
  let evaluatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const listing of filtered) {
    const dbListing = await prisma.filteredListing.findUnique({
      where: { url: listing.url },
    });
    if (!dbListing) continue;

    // Skip if already evaluated
    const existing = await prisma.evaluation.findUnique({
      where: { listingId: dbListing.id },
    });
    if (existing) {
      skippedCount++;
      continue;
    }

    try {
      const evaluation = await deps.evaluateListing(listing);
      evaluatedCount++;

      const isOpportunity =
        evaluation.margin != null &&
        evaluation.margin >= config.minMargin &&
        evaluation.confidence >= config.minConfidence;

      await prisma.evaluation.create({
        data: {
          listing: { connect: { id: dbListing.id } },
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
    } catch (error) {
      errorCount++;
      console.error(`Failed to evaluate listing: ${listing.title.slice(0, 50)}...`);
      console.error(error instanceof Error ? error.message : error);
      // Continue with next listing instead of crashing
    }
  }

  console.log(`Evaluation complete: ${evaluatedCount} evaluated, ${skippedCount} skipped, ${errorCount} errors`);

  // 5. Send alerts for opportunities (separate from evaluation)
  if (opportunities.length > 0) {
    console.log(`Found ${opportunities.length} opportunities!`);
    await deps.sendAlert(opportunities);
  } else {
    console.log("No opportunities found this run.");
  }

  console.log("Scan complete.");
}
