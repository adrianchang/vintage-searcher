import { PrismaClient } from "./generated/prisma/client";
import { type Platform } from "./services/ecommerce";
import { sendDigestEmail, type DigestItem } from "./services/email";
import { combinedScore } from "./services/score";
import {
  runIdentification as defaultRunIdentification,
  runValuation as defaultRunValuation,
  computePersonalScores,
  computeDislikeScores,
  type IdentificationResult,
  type ValuationOutput,
} from "./services/evaluate";
import { DEFAULT_KEYWORDS } from "./configs/digests";
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
  fetchListings: (platform: Platform, count: number, queries: { query: string; count: number }[]) => Promise<Listing[]>;
  filterListings: (listings: Listing[]) => Promise<Listing[]>;
  runIdentification?: typeof defaultRunIdentification;
  runValuation?: typeof defaultRunValuation;
}

// Distribute total listings across keywords using percentage weights.
// Uses largest remainder method so counts sum exactly to total.
function resolveKeywordCounts(
  keywords: { query: string; percentage: number }[],
  total: number,
): { query: string; count: number }[] {
  if (keywords.length === 0) return [];
  const sum = keywords.reduce((s, k) => s + k.percentage, 0);
  const items = keywords.map(k => {
    const exact = (k.percentage / sum) * total;
    return { query: k.query, exact, count: Math.floor(exact) };
  });
  const remaining = total - items.reduce((s, i) => s + i.count, 0);
  items
    .map((item, i) => ({ i, remainder: item.exact - item.count }))
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, remaining)
    .forEach(({ i }) => items[i].count++);
  return items.map(({ query, count }) => ({ query, count }));
}

function buildEvaluationFromParts(
  dbEvaluation: any,
  story: Pick<IdentificationResult, 'hook' | 'brandStory' | 'itemStory' | 'historicalContext' | 'marketContext' | 'styleGuide' | 'storyScore' | 'storyScoreReasoning'>,
): Evaluation {
  return {
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
    priceScore: dbEvaluation.priceScore ?? undefined,
    hook: story.hook,
    brandStory: story.brandStory,
    itemStory: story.itemStory,
    historicalContext: story.historicalContext,
    marketContext: story.marketContext,
    styleGuide: story.styleGuide,
    storyScore: story.storyScore,
    storyScoreReasoning: story.storyScoreReasoning,
  };
}

export async function runScan(
  config: ScanConfig,
  deps: ScanDeps,
  onProgress?: (progress: ScanProgress) => void,
  testRecipients?: string[],
) {
  const { prisma } = deps;
  const identify = deps.runIdentification ?? defaultRunIdentification;
  const valuate = deps.runValuation ?? defaultRunValuation;

  console.log(`Starting vintage scan on ${config.platform}...`);

  // 1. Load all users with their keywords and vote history
  let users = await prisma.user.findMany({
    where: { email: { not: null } },
    include: {
      keywords: true,
      votes: {
        include: { story: true },
        orderBy: { createdAt: "desc" },
        take: 40,
      },
    },
  });

  if (testRecipients) {
    users = users.filter(u => u.email && testRecipients.includes(u.email));
  }

  if (users.length === 0) {
    console.log("No users — scan skipped");
    onProgress?.({ stage: 'done', message: 'No users', opportunities: 0 });
    return;
  }

  // 2. Resolve keywords per user (fall back to defaults if none set)
  const usersWithKW = users.map(user => ({
    ...user,
    resolvedKeywords: (user.keywords.length > 0 ? user.keywords : DEFAULT_KEYWORDS) as { query: string; percentage: number }[],
  }));

  // 3. Collect unique queries with max count across all users
  const queryCountMap = new Map<string, number>();
  for (const user of usersWithKW) {
    for (const { query, count } of resolveKeywordCounts(user.resolvedKeywords, config.maxListings)) {
      queryCountMap.set(query, Math.max(queryCountMap.get(query) ?? 0, count));
    }
  }
  console.log(`Unique queries (${queryCountMap.size}): ${[...queryCountMap.keys()].join(", ")}`);

  // 4. Fetch listings once per unique query
  const queryResults = new Map<string, Listing[]>();
  for (const [query, count] of queryCountMap) {
    onProgress?.({ stage: 'fetch', message: `Fetching: "${query}"` });
    const results = await deps.fetchListings(config.platform, count, [{ query, count }]);
    queryResults.set(query, results);
    console.log(`  "${query}" → ${results.length} listings`);
  }

  // 5. Per-user: build listing pool, filter, evaluate (shared cache), generate stories, send
  const evalCache = new Map<string, { dbEvaluation: any }>();
  let evalCount = 0;
  let evalErrors = 0;
  let totalSent = 0;

  for (const user of usersWithKW) {
    if (!user.email) continue;
    console.log(`\n--- User: ${user.email} (${user.language}) ---`);

    // Build this user's listing pool: N per keyword, deduped
    const kwCounts = resolveKeywordCounts(user.resolvedKeywords, config.maxListings);
    const userListingsMap = new Map<string, Listing>();
    for (const { query, count } of kwCounts) {
      for (const listing of (queryResults.get(query) ?? []).slice(0, count)) {
        userListingsMap.set(listing.url, listing);
      }
    }

    // Filter per-user
    const filtered = await deps.filterListings([...userListingsMap.values()]);
    console.log(`  ${filtered.length} listings passed filter`);
    onProgress?.({ stage: 'filter', message: `${filtered.length} passed filter` });

    const goodFinds: DigestItem[] = [];

    for (const listing of filtered) {
      // Skip early if already sent to this user
      const alreadyDelivered = await prisma.storyDelivery.findUnique({
        where: { userId_url: { userId: user.id, url: listing.url } },
      });
      if (alreadyDelivered) {
        console.log(`  Skipping (already sent): ${listing.title.slice(0, 60)}`);
        continue;
      }

      let cached = evalCache.get(listing.url);

      if (!cached) {
        let dbEvaluation = await prisma.evaluation.findUnique({ where: { url: listing.url } });

        if (!dbEvaluation) {
          onProgress?.({
            stage: 'evaluate',
            message: `Evaluating: ${listing.title.slice(0, 50)}...`,
            evaluated: evalCount,
            total: filtered.length,
          });

          try {
            const identification = await identify(listing);
            const valuation = await valuate(listing, identification);

            evalCount++;
            const hasSoldData = (valuation.soldListings?.length ?? 0) > 0;

            dbEvaluation = await prisma.evaluation.create({
              data: {
                url: listing.url,
                isAuthentic: identification.isAuthentic,
                itemIdentification: identification.itemIdentification,
                identificationConfidence: identification.identificationConfidence,
                estimatedEra: identification.estimatedEra,
                estimatedValue: hasSoldData ? (valuation.estimatedValue ?? null) : listing.price,
                currentPrice: valuation.currentPrice,
                margin: hasSoldData ? (valuation.margin ?? null) : 0,
                confidence: valuation.confidence,
                reasoning: valuation.reasoning,
                redFlags: JSON.stringify(identification.redFlags),
                references: JSON.stringify(valuation.references),
                soldListings: JSON.stringify(valuation.soldListings ?? []),
                priceScore: hasSoldData ? (valuation.priceScore ?? 0) : 0,
                isOpportunity: true,
              },
            });
          } catch (error) {
            evalErrors++;
            console.error(`Failed to evaluate: ${listing.title.slice(0, 50)}`);
            console.error(error instanceof Error ? error.message : error);
            continue;
          }
        }

        cached = { dbEvaluation };
        evalCache.set(listing.url, cached);
      }

      const { dbEvaluation } = cached;

      // Stories are keyed by (evaluationId, language) — configId = language as a natural dedup key
      const storyWhere = { evaluationId: dbEvaluation.id, language: user.language, configId: user.language };
      let existingStory = await prisma.story.findUnique({ where: { evaluationId_language_configId: storyWhere } });

      if (!existingStory) {
        try {
          // Phase 1 again, this time with language instruction for story fields
          const identification = await identify(listing, user.language);
          const baseScore = combinedScore(buildEvaluationFromParts(dbEvaluation, identification));

          existingStory = await prisma.story.create({
            data: {
              evaluation: { connect: { id: dbEvaluation.id } },
              language: user.language,
              configId: user.language,
              hook: identification.hook,
              brandStory: identification.brandStory,
              itemStory: identification.itemStory,
              historicalContext: identification.historicalContext,
              marketContext: identification.marketContext,
              styleGuide: identification.styleGuide,
              storyScore: identification.storyScore,
              storyScoreReasoning: identification.storyScoreReasoning,
              combinedScore: baseScore,
            },
          });

          const storyEval = buildEvaluationFromParts(dbEvaluation, identification);
          goodFinds.push({ listing, evaluation: storyEval, score: baseScore, storyId: existingStory.id });
          console.log(`  Scored ${(baseScore * 100).toFixed(0)}%: ${listing.title.slice(0, 60)}`);
        } catch (error) {
          console.error(`Failed story for: ${listing.title.slice(0, 50)}`);
          console.error(error instanceof Error ? error.message : error);
        }
      } else {
        const storyEval = buildEvaluationFromParts(dbEvaluation, existingStory);
        const score = existingStory.combinedScore;
        goodFinds.push({ listing, evaluation: storyEval, score, storyId: existingStory.id });
        console.log(`  Scored ${(score * 100).toFixed(0)}% (cached): ${listing.title.slice(0, 60)}`);
      }
    }

    if (goodFinds.length === 0) {
      console.log(`  No candidates`);
      continue;
    }

    // Personalize ranking if user has votes
    const likedStories = user.votes
      .filter(v => v.direction === "up").slice(0, 20)
      .map(v => ({ itemIdentification: v.story.hook, styleGuide: v.story.styleGuide, hook: v.story.hook, marketContext: v.story.marketContext }));

    const dislikedStories = user.votes
      .filter(v => v.direction === "down").slice(0, 20)
      .map(v => ({ itemIdentification: v.story.hook, styleGuide: v.story.styleGuide, hook: v.story.hook, marketContext: v.story.marketContext }));

    let scoredFinds = goodFinds;
    if (likedStories.length > 0 || dislikedStories.length > 0) {
      console.log(`  Personalizing: ${likedStories.length} liked, ${dislikedStories.length} disliked`);
      const candidates = goodFinds.map(f => ({
        itemIdentification: f.evaluation.itemIdentification,
        styleGuide: f.evaluation.styleGuide,
        hook: f.evaluation.hook,
        marketContext: f.evaluation.marketContext,
      }));
      const [personalScores, dislikeScores] = await Promise.all([
        computePersonalScores(candidates, likedStories),
        computeDislikeScores(candidates, dislikedStories),
      ]);
      scoredFinds = goodFinds.map((find, i) => ({
        ...find,
        score: combinedScore(find.evaluation, personalScores[i], dislikeScores[i]),
      }));
    }

    const TOP_N = 3;
    const toSend = [...scoredFinds].sort((a, b) => b.score - a.score).slice(0, TOP_N);
    console.log(`  Sending top ${toSend.length} of ${goodFinds.length} candidates`);
    await sendDigestEmail(toSend, user.email, user.language);

    // Record deliveries so these listings are never resent to this user
    for (const find of toSend) {
      await prisma.storyDelivery.create({
        data: { userId: user.id, url: find.listing.url },
      });
    }

    totalSent++;
  }

  onProgress?.({ stage: 'done', message: 'Scan complete', opportunities: totalSent });
}
