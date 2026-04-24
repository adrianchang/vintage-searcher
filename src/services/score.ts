import type { Evaluation } from "../types";

export const COMBINED_SCORE_THRESHOLD = 0.65;

export function priceScore(evaluation: Evaluation): number {
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
  if (year >= 2000) return 0.85;
  return 1;
}

// 80% story, 20% price, with era penalty for recent items
export function combinedScore(evaluation: Evaluation): number {
  const base = evaluation.storyScore * 0.8 + priceScore(evaluation) * 0.2;
  return base * eraPenalty(evaluation.estimatedEra);
}

export function isGoodFind(evaluation: Evaluation): boolean {
  return combinedScore(evaluation) >= COMBINED_SCORE_THRESHOLD;
}
