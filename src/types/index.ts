// Listing from any platform (normalized)
export interface Listing {
  url: string;
  platform: string;
  title: string;
  price: number;
  imageUrls: string[];
  description: string;
  rawData: Record<string, unknown>;
}

// LLM evaluation output
export interface Evaluation {
  isAuthentic: boolean;
  itemIdentification: string;
  identificationConfidence: number;
  estimatedEra: string | null;
  estimatedValue: number | null;
  currentPrice: number;
  margin: number | null;
  confidence: number;
  reasoning: string;
  redFlags: string[];
  references: string[];
  soldListings: { title: string; price: number | null; url: string | null }[];
  // Story fields
  hook: string;
  brandStory: string;
  itemStory: string;
  historicalContext: string;
  marketContext: string;
  storyScore: number;
  storyScoreReasoning: string;
  priceScore?: number;
}

// Config for the scanner
export interface ScanConfig {
  platform: "ebay"; // Add more platforms here as we scale
  maxListings: number;
  minMargin: number;
  minConfidence: number;
}
