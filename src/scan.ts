import { PrismaClient } from "./generated/prisma/client";
import { type Platform } from "./services/ecommerce";
import { sendDigestEmail, type DigestItem } from "./services/email";
import { combinedScore, isGoodFind, priceScore } from "./services/score";
import { runIdentification as defaultRunIdentification } from "./services/evaluate";
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
  fetchListings: (platform: Platform, limit: number) => Promise<Listing[]>;
  filterListings: (listings: Listing[]) => Promise<Listing[]>;
  evaluateListing: (listing: Listing, lang?: string) => Promise<Evaluation>;
  runIdentification?: typeof defaultRunIdentification;
}

const SUPPORTED_LANGUAGES = ["en", "zh"] as const;
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export async function runScan(
  config: ScanConfig,
  deps: ScanDeps,
  _userId?: string,
  onProgress?: (progress: ScanProgress) => void,
  testRecipients?: string[],
) {
  const { prisma } = deps;
  console.log(`Starting vintage scan on ${config.platform}...`);

  // 1. Fetch
  const listings = await deps.fetchListings(config.platform, config.maxListings);
  console.log(`Fetched ${listings.length} listings`);
  onProgress?.({ stage: 'fetch', message: `Fetched ${listings.length} listings` });

  // 2. Filter
  const filtered = await deps.filterListings(listings);
  console.log(`${filtered.length} listings passed filter`);
  onProgress?.({ stage: 'filter', message: `${filtered.length} passed filter` });

  // 3. Store filtered listings
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

  // 4. Evaluate listings (EN pass — runs both Phase 1 + Phase 2)
  // Builds evaluation records and EN stories. Collects per-language good finds.
  const goodFindsByLang: Record<SupportedLanguage, DigestItem[]> = { en: [], zh: [] };
  let evaluatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const listing of filtered) {
    const dbListing = await prisma.filteredListing.findUnique({
      where: { url: listing.url },
    });
    if (!dbListing) continue;

    onProgress?.({
      stage: 'evaluate',
      message: `Evaluating: ${listing.title.slice(0, 50)}...`,
      evaluated: evaluatedCount + skippedCount,
      total: filtered.length,
    });

    try {
      // Check if Evaluation already exists
      let dbEvaluation = await prisma.evaluation.findUnique({
        where: { listingId: dbListing.id },
      });

      let enEvaluation: Evaluation | null = null;

      if (!dbEvaluation) {
        // Run full evaluation (EN): Phase 1 (identification + EN story) + Phase 2 (valuation)
        enEvaluation = await deps.evaluateListing(listing, "en");
        evaluatedCount++;

        const score = combinedScore(enEvaluation);
        const qualifies = isGoodFind(enEvaluation);

        dbEvaluation = await prisma.evaluation.create({
          data: {
            listing: { connect: { id: dbListing.id } },
            isAuthentic: enEvaluation.isAuthentic,
            itemIdentification: enEvaluation.itemIdentification,
            identificationConfidence: enEvaluation.identificationConfidence,
            estimatedEra: enEvaluation.estimatedEra,
            estimatedValue: enEvaluation.estimatedValue,
            currentPrice: enEvaluation.currentPrice,
            margin: enEvaluation.margin,
            confidence: enEvaluation.confidence,
            reasoning: enEvaluation.reasoning,
            redFlags: JSON.stringify(enEvaluation.redFlags),
            references: JSON.stringify(enEvaluation.references),
            soldListings: JSON.stringify(enEvaluation.soldListings),
            isOpportunity: qualifies,
          },
        });

        // Persist EN story
        await prisma.story.create({
          data: {
            evaluation: { connect: { id: dbEvaluation.id } },
            language: "en",
            hook: enEvaluation.hook,
            brandStory: enEvaluation.brandStory,
            itemStory: enEvaluation.itemStory,
            historicalContext: enEvaluation.historicalContext,
            marketContext: enEvaluation.marketContext,
            storyScore: enEvaluation.storyScore,
            storyScoreReasoning: enEvaluation.storyScoreReasoning,
            combinedScore: score,
          },
        });

        if (qualifies) {
          goodFindsByLang.en.push({ listing, evaluation: enEvaluation, score });
          console.log(`  ✓ EN good find (score ${(score * 100).toFixed(0)}%): ${listing.title.slice(0, 60)}`);
        } else {
          console.log(`  ✗ Scored ${(score * 100).toFixed(0)}% — below threshold: ${listing.title.slice(0, 60)}`);
        }
      } else {
        skippedCount++;
      }

      // 5. Generate ZH story (Phase 1 only — reuses existing valuation)
      const existingZhStory = await prisma.story.findUnique({
        where: { evaluationId_language: { evaluationId: dbEvaluation.id, language: "zh" } },
      });

      if (!existingZhStory) {
        const identify = deps.runIdentification ?? defaultRunIdentification;
        const zhIdentification = await identify(listing, "zh");
        const enStory = await prisma.story.findUnique({
          where: { evaluationId_language: { evaluationId: dbEvaluation.id, language: "en" } },
        });
        const zhCombinedScore = enStory?.combinedScore ?? 0;

        await prisma.story.create({
          data: {
            evaluation: { connect: { id: dbEvaluation.id } },
            language: "zh",
            hook: zhIdentification.hook,
            brandStory: zhIdentification.brandStory,
            itemStory: zhIdentification.itemStory,
            historicalContext: zhIdentification.historicalContext,
            marketContext: zhIdentification.marketContext,
            storyScore: zhIdentification.storyScore,
            storyScoreReasoning: zhIdentification.storyScoreReasoning,
            combinedScore: zhCombinedScore,
          },
        });

        // Build ZH DigestItem from evaluation data if it qualifies
        if (dbEvaluation.isOpportunity) {
          const zhEvaluation: Evaluation = {
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
            hook: zhIdentification.hook,
            brandStory: zhIdentification.brandStory,
            itemStory: zhIdentification.itemStory,
            historicalContext: zhIdentification.historicalContext,
            marketContext: zhIdentification.marketContext,
            storyScore: zhIdentification.storyScore,
            storyScoreReasoning: zhIdentification.storyScoreReasoning,
          };
          goodFindsByLang.zh.push({ listing, evaluation: zhEvaluation, score: zhCombinedScore });
        }
      } else if (dbEvaluation.isOpportunity && enEvaluation === null) {
        // Re-run already had EN eval skipped — still need ZH good finds for email
        const zhEvaluation: Evaluation = {
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
          hook: existingZhStory.hook,
          brandStory: existingZhStory.brandStory,
          itemStory: existingZhStory.itemStory,
          historicalContext: existingZhStory.historicalContext,
          marketContext: existingZhStory.marketContext,
          storyScore: existingZhStory.storyScore,
          storyScoreReasoning: existingZhStory.storyScoreReasoning,
        };
        goodFindsByLang.zh.push({ listing, evaluation: zhEvaluation, score: existingZhStory.combinedScore });
      }

    } catch (error) {
      errorCount++;
      console.error(`Failed to evaluate: ${listing.title.slice(0, 50)}`);
      console.error(error instanceof Error ? error.message : error);
    }
  }

  console.log(`Evaluation complete: ${evaluatedCount} evaluated, ${skippedCount} skipped, ${errorCount} errors`);

  // 6. Send language-specific digest emails
  let recipientsByLang: Record<string, string[]> = {};

  if (testRecipients) {
    // Test mode: look up languages for the test recipients only
    const testUsers = await prisma.user.findMany({
      where: { email: { in: testRecipients } },
      select: { email: true, language: true },
    });
    for (const user of testUsers) {
      const lang = user.language || "en";
      if (!recipientsByLang[lang]) recipientsByLang[lang] = [];
      recipientsByLang[lang].push(user.email!);
    }
  } else {
    const users = await prisma.user.findMany({
      where: { email: { not: null } },
      select: { email: true, language: true },
    });
    for (const user of users) {
      const lang = user.language || "en";
      if (!recipientsByLang[lang]) recipientsByLang[lang] = [];
      recipientsByLang[lang].push(user.email!);
    }
  }

  for (const lang of SUPPORTED_LANGUAGES) {
    const finds = goodFindsByLang[lang];
    const recipients = recipientsByLang[lang] ?? [];
    if (finds.length === 0) {
      console.log(`No good finds for ${lang} — skipping email`);
      continue;
    }
    finds.sort((a, b) => b.score - a.score);
    await sendDigestEmail(finds, recipients, lang);
  }

  onProgress?.({
    stage: 'done',
    message: `Found ${goodFindsByLang.en.length} good finds`,
    opportunities: goodFindsByLang.en.length,
  });
}
