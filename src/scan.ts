import { PrismaClient } from "./generated/prisma/client";
import { type Platform } from "./services/ecommerce";
import { type FilterOptions } from "./services/filter";
import { sendDigestEmail, type DigestItem } from "./services/email";
import { combinedScore, isGoodFind, COMBINED_SCORE_THRESHOLD } from "./services/score";
import { runIdentification as defaultRunIdentification } from "./services/evaluate";
import { DIGEST_CONFIGS, type DigestConfig } from "./configs/digests";
import type { Listing, Evaluation, ScanConfig } from "./types";

export type ScanProgress = {
  stage: 'fetch' | 'filter' | 'evaluate' | 'done' | 'error';
  message: string;
  evaluated?: number;
  total?: number;
  opportunities?: number;
};

export interface ScanDeps {
  prisma: PrismaClient;
  fetchListings: (platform: Platform, limit: number, queries?: { query: string; count: number }[]) => Promise<Listing[]>;
  filterListings: (listings: Listing[], options?: FilterOptions) => Promise<Listing[]>;
  evaluateListing: (listing: Listing, lang?: string, promptAppend?: string) => Promise<Evaluation>;
  runIdentification?: typeof defaultRunIdentification;
  configs?: DigestConfig[];
}

export async function runScan(
  config: ScanConfig,
  deps: ScanDeps,
  _userId?: string,
  onProgress?: (progress: ScanProgress) => void,
  testRecipients?: string[],
) {
  const { prisma } = deps;
  console.log(`Starting vintage scan on ${config.platform}...`);

  const configs = deps.configs ?? DIGEST_CONFIGS;
  let totalOpportunities = 0;

  // Collect all emails claimed by special (non-default) configs to avoid duplicates
  const specialRecipients = new Set(
    configs.filter(c => !c.isDefault).flatMap(c => c.recipients)
  );

  for (const digestConfig of configs) {
    // For default configs, merge in all DB users with matching language
    let baseRecipients = [...digestConfig.recipients];
    if (digestConfig.isDefault && !testRecipients) {
      const dbUsers = await prisma.user.findMany({ where: { language: digestConfig.language } });
      for (const user of dbUsers) {
        if (!user.email) continue;
        if (!specialRecipients.has(user.email) && !baseRecipients.includes(user.email)) {
          baseRecipients.push(user.email);
        }
      }
    }

    if (baseRecipients.length === 0) continue;

    const recipients = testRecipients
      ? testRecipients.filter(r => baseRecipients.includes(r))
      : baseRecipients;

    if (recipients.length === 0) continue;

    console.log(`\n--- Config: ${digestConfig.id} (${digestConfig.language}) → ${recipients.join(", ")} ---`);

    await runConfigScan(config, deps, digestConfig, recipients, onProgress);
    totalOpportunities++;
  }

  onProgress?.({
    stage: 'done',
    message: `Scan complete`,
    opportunities: totalOpportunities,
  });
}

async function runConfigScan(
  config: ScanConfig,
  deps: ScanDeps,
  digestConfig: DigestConfig,
  recipients: string[],
  onProgress?: (progress: ScanProgress) => void,
) {
  const { prisma } = deps;
  const { language, searchKeywords, filter: filterOptions, promptAppend, id: configId } = digestConfig;

  // 1. Fetch
  const listings = await deps.fetchListings(config.platform, config.maxListings, searchKeywords);
  console.log(`Fetched ${listings.length} listings`);
  onProgress?.({ stage: 'fetch', message: `[${configId}] Fetched ${listings.length} listings` });

  // 2. Filter
  const filtered = await deps.filterListings(listings, filterOptions);
  console.log(`${filtered.length} listings passed filter`);
  onProgress?.({ stage: 'filter', message: `[${configId}] ${filtered.length} passed filter` });

  // 3. Store filtered listings (global — deduped by URL)
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

  // 4. Evaluate + story per listing
  const goodFinds: DigestItem[] = [];
  let evaluatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const listing of filtered) {
    const dbListing = await prisma.filteredListing.findUnique({ where: { url: listing.url } });
    if (!dbListing) continue;

    onProgress?.({
      stage: 'evaluate',
      message: `[${configId}] Evaluating: ${listing.title.slice(0, 50)}...`,
      evaluated: evaluatedCount + skippedCount,
      total: filtered.length,
    });

    try {
      // Get or create Evaluation (shared across configs — price data is config-agnostic)
      let dbEvaluation = await prisma.evaluation.findUnique({ where: { listingId: dbListing.id } });
      let baseEvaluation: Evaluation | null = null;

      if (!dbEvaluation) {
        baseEvaluation = await deps.evaluateListing(listing, language, promptAppend);
        evaluatedCount++;

        const score = combinedScore(baseEvaluation);
        const qualifies = isGoodFind(baseEvaluation);

        dbEvaluation = await prisma.evaluation.create({
          data: {
            listing: { connect: { id: dbListing.id } },
            isAuthentic: baseEvaluation.isAuthentic,
            itemIdentification: baseEvaluation.itemIdentification,
            identificationConfidence: baseEvaluation.identificationConfidence,
            estimatedEra: baseEvaluation.estimatedEra,
            estimatedValue: baseEvaluation.estimatedValue,
            currentPrice: baseEvaluation.currentPrice,
            margin: baseEvaluation.margin,
            confidence: baseEvaluation.confidence,
            reasoning: baseEvaluation.reasoning,
            redFlags: JSON.stringify(baseEvaluation.redFlags),
            references: JSON.stringify(baseEvaluation.references),
            soldListings: JSON.stringify(baseEvaluation.soldListings),
            priceScore: baseEvaluation.priceScore ?? null,
            isOpportunity: qualifies,
          },
        });
      } else {
        skippedCount++;
      }

      // Get or create Story for this (evaluation, language, config)
      const existingStory = await prisma.story.findUnique({
        where: { evaluationId_language_configId: { evaluationId: dbEvaluation.id, language, configId } },
      });

      let storyEvaluation: Evaluation;

      if (!existingStory) {
        const identify = deps.runIdentification ?? defaultRunIdentification;
        const identification = await identify(listing, language, promptAppend);
        const score = combinedScore({
          ...identification,
          estimatedValue: dbEvaluation.estimatedValue,
          margin: dbEvaluation.margin,
          currentPrice: dbEvaluation.currentPrice,
          isAuthentic: dbEvaluation.isAuthentic,
          identificationConfidence: dbEvaluation.identificationConfidence,
          estimatedEra: dbEvaluation.estimatedEra,
          confidence: dbEvaluation.confidence,
          reasoning: dbEvaluation.reasoning,
          redFlags: JSON.parse(dbEvaluation.redFlags),
          references: JSON.parse(dbEvaluation.references),
          soldListings: JSON.parse(dbEvaluation.soldListings),
        });

        // Update isOpportunity based on Phase 1 score — overrides Phase 2's preliminary value
        const isOpportunity = score >= COMBINED_SCORE_THRESHOLD;
        await prisma.evaluation.update({
          where: { id: dbEvaluation.id },
          data: { isOpportunity },
        });

        await prisma.story.create({
          data: {
            evaluation: { connect: { id: dbEvaluation.id } },
            language,
            configId,
            hook: identification.hook,
            brandStory: identification.brandStory,
            itemStory: identification.itemStory,
            historicalContext: identification.historicalContext,
            marketContext: identification.marketContext,
            storyScore: identification.storyScore,
            storyScoreReasoning: identification.storyScoreReasoning,
            combinedScore: score,
          },
        });

        storyEvaluation = {
          isAuthentic: dbEvaluation.isAuthentic,
          itemIdentification: dbEvaluation.itemIdentification,
          identificationConfidence: dbEvaluation.identificationConfidence,
          estimatedEra: dbEvaluation.estimatedEra,
          estimatedValue: dbEvaluation.estimatedValue,
          currentPrice: dbEvaluation.currentPrice,
          margin: dbEvaluation.margin,
          confidence: dbEvaluation.confidence,
          reasoning: dbEvaluation.reasoning,
          redFlags: JSON.parse(dbEvaluation.redFlags),
          references: JSON.parse(dbEvaluation.references),
          soldListings: JSON.parse(dbEvaluation.soldListings),
          hook: identification.hook,
          brandStory: identification.brandStory,
          itemStory: identification.itemStory,
          historicalContext: identification.historicalContext,
          marketContext: identification.marketContext,
          storyScore: identification.storyScore,
          storyScoreReasoning: identification.storyScoreReasoning,
        };

        if (isOpportunity) {
          goodFinds.push({ listing, evaluation: storyEvaluation, score });
          console.log(`  ✓ Good find (score ${(score * 100).toFixed(0)}%): ${listing.title.slice(0, 60)}`);
        } else {
          console.log(`  ✗ Scored ${(score * 100).toFixed(0)}% — below threshold`);
        }
      } else if (dbEvaluation.isOpportunity) {
        // Story already exists — use it for email
        storyEvaluation = {
          isAuthentic: dbEvaluation.isAuthentic,
          itemIdentification: dbEvaluation.itemIdentification,
          identificationConfidence: dbEvaluation.identificationConfidence,
          estimatedEra: dbEvaluation.estimatedEra,
          estimatedValue: dbEvaluation.estimatedValue,
          currentPrice: dbEvaluation.currentPrice,
          margin: dbEvaluation.margin,
          confidence: dbEvaluation.confidence,
          reasoning: dbEvaluation.reasoning,
          redFlags: JSON.parse(dbEvaluation.redFlags),
          references: JSON.parse(dbEvaluation.references),
          soldListings: JSON.parse(dbEvaluation.soldListings),
          hook: existingStory.hook,
          brandStory: existingStory.brandStory,
          itemStory: existingStory.itemStory,
          historicalContext: existingStory.historicalContext,
          marketContext: existingStory.marketContext,
          storyScore: existingStory.storyScore,
          storyScoreReasoning: existingStory.storyScoreReasoning,
        };
        goodFinds.push({ listing, evaluation: storyEvaluation, score: existingStory.combinedScore });
      }

    } catch (error) {
      errorCount++;
      console.error(`Failed to evaluate: ${listing.title.slice(0, 50)}`);
      console.error(error instanceof Error ? error.message : error);
    }
  }

  console.log(`[${configId}] Evaluation complete: ${evaluatedCount} evaluated, ${skippedCount} skipped, ${errorCount} errors`);
  console.log(`[${configId}] Good finds: ${goodFinds.length}`);

  // 5. Send digest email
  if (goodFinds.length > 0) {
    goodFinds.sort((a, b) => b.score - a.score);
    await sendDigestEmail(goodFinds, recipients, language);
  } else {
    console.log(`[${configId}] No good finds — no email sent`);
  }
}
