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
  estimatedEra: string;
  estimatedValue: number;
  currentPrice: number;
  margin: number;
  confidence: number;
  reasoning: string;
  redFlags: string[];
  references: string[];
}

// Config for the scanner
export interface ScanConfig {
  platform: "ebay"; // Add more platforms here as we scale
  maxListings: number;
  minMargin: number;
  minConfidence: number;
}
