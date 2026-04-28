import type { Evaluation } from "../types";

export const COMBINED_SCORE_THRESHOLD = 0.7;

export function priceScore(evaluation: Evaluation): number {
  if (evaluation.priceScore != null) return evaluation.priceScore;
  const { margin, estimatedValue } = evaluation;
  if (margin == null || estimatedValue == null || estimatedValue <= 0 || margin < 20) return 0;
  return Math.min(margin / estimatedValue, 1);
}

// Items from 2010s or later are penalized — less vintage, less story value
function eraPenalty(era: string | null | undefined): number {
  if (!era) return 1;
  const match = era.match(/(\d{4})/);
  if (!match) return 1;
  const year = parseInt(match[1]);
  if (year >= 2010) return 0.7;
  return 1;
}

// Base: 80% story, 20% price. Personalized: 40% personal favor, 30% story, 30% price.
// dislikeSimilarity (0-1) is applied as a multiplier penalty: score × (1 - dislikeSimilarity).
export function combinedScore(evaluation: Evaluation, personalFavorScore?: number, dislikeSimilarity?: number): number {
  const story = evaluation.storyScore;
  const price = priceScore(evaluation);
  const penalty = eraPenalty(evaluation.estimatedEra);
  const base = personalFavorScore != null
    ? (personalFavorScore * 0.4 + story * 0.3 + price * 0.3) * penalty
    : (story * 0.8 + price * 0.2) * penalty;
  return dislikeSimilarity != null ? base * (1 - dislikeSimilarity) : base;
}

export function isGoodFind(evaluation: Evaluation): boolean {
  return combinedScore(evaluation) >= COMBINED_SCORE_THRESHOLD;
}
