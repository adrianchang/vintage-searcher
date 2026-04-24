import type { SearchQueryInput } from "../services/ecommerce";

export interface DigestConfig {
  id: string;
  language: "en" | "zh";
  searchKeywords: SearchQueryInput[];
  filter?: {
    minPrice?: number;
    maxPrice?: number;
  };
  promptAppend?: string;
  recipients: string[];
  isDefault?: boolean; // if true, also sends to all DB users with matching language
}

const DEFAULT_KEYWORDS: SearchQueryInput[] = [
  { query: "vintage workwear jacket", count: 8 },
  { query: "vintage denim", count: 8 },
  { query: "vintage outerwear", count: 8 },
  { query: "vintage flannel shirt", count: 6 },
];

export const DIGEST_CONFIGS: DigestConfig[] = [
  {
    id: "en-default",
    language: "en",
    searchKeywords: DEFAULT_KEYWORDS,
    recipients: ["adrian.aa.chang.aa@gmail.com", "weihsiu@gmail.com"],
    isDefault: true,
  },
  {
    id: "zh-default",
    language: "zh",
    searchKeywords: DEFAULT_KEYWORDS,
    recipients: ["adrian.aa.chang@gmail.com"],
    isDefault: true,
  },
  // Config 3 — TBD
  // Config 4 — TBD
];
