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
  itemIdentification: string;        // What the agent thinks the item actually is
  identificationConfidence: number;  // How confident the agent is in its identification (0-1)
  estimatedEra: string | null;    // Null if can't determine era (non-vintage items)
  estimatedValue: number | null;  // Null if can't estimate (non-vintage items)
  currentPrice: number;
  margin: number | null;          // Null if estimatedValue is null
  confidence: number;             // Confidence in the valuation/pricing (0-1)
  reasoning: string;
  redFlags: string[];
  references: string[];
  soldListings: { title: string; price: number | null; url: string | null }[];
}

// Config for the scanner
export interface ScanConfig {
  platform: "ebay"; // Add more platforms here as we scale
  maxListings: number;
  minMargin: number;
  minConfidence: number;
}
