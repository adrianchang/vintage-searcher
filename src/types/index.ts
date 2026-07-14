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
  mainStory: string;
  storyScore: number;
  storyScoreReasoning: string;
  styleGuide: string;
  priceScore?: number;
  // Size extraction (optional — null/absent on evaluations predating size matching)
  garmentType?: string | null;
  labeledSize?: string | null;
  pitToPitInches?: number | null;
  waistInches?: number | null;
  sizeConfidence?: number | null;
}

// Config for the scanner
export interface ScanConfig {
  platform: "ebay"; // Add more platforms here as we scale
  maxListings: number;
  minMargin: number;
  minConfidence: number;
}
