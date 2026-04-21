import type { Evaluation } from "../types";

export const COMBINED_SCORE_THRESHOLD = 0.65;

// How undervalued the item is, normalized to 0–1.
// Uses margin as a fraction of estimated value, capped at 1.
// Examples: $100 margin on $150 item → 0.67 → priceScore ~0.8
//           margin < $20 → 0
export function priceScore(evaluation: Evaluation): number {
  const { margin, estimatedValue } = evaluation;
  if (margin == null || estimatedValue == null || estimatedValue <= 0 || margin < 20) return 0;
  return Math.min(margin / estimatedValue, 1);
}

// 80% story, 20% price
export function combinedScore(evaluation: Evaluation): number {
  return evaluation.storyScore * 0.8 + priceScore(evaluation) * 0.2;
}

export function isGoodFind(evaluation: Evaluation): boolean {
  return combinedScore(evaluation) >= COMBINED_SCORE_THRESHOLD;
}
