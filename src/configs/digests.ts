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
  { query: "vintage workwear jacket", count: 5 },
  { query: "vintage denim", count: 5 },
  { query: "vintage outerwear", count: 5 },
  { query: "vintage flannel shirt", count: 5 },
];

const CONTEMPORARY_KEYWORDS: SearchQueryInput[] = [
  { query: "vintage leather jacket", count: 5 },
  { query: "vintage outerwear", count: 5 },
  { query: "archive jacket", count: 5 },
  { query: "rare japanese jacket", count: 5 },
];

const SOUVENIR_KEYWORDS: SearchQueryInput[] = [
  { query: "vintage workwear jacket", count: 5 },
  { query: "vintage denim", count: 5 },
  { query: "vintage chinese souvenir jacket", count: 5 },
  { query: "vintage taiwan souvenir outerwear", count: 5 },
];

export const DIGEST_CONFIGS: DigestConfig[] = [
  {
    id: "en-default",
    language: "en",
    searchKeywords: DEFAULT_KEYWORDS,
    recipients: ["adrian.aa.chang.aa@gmail.com"],
    isDefault: true,
  },
  {
    id: "zh-default",
    language: "zh",
    searchKeywords: DEFAULT_KEYWORDS,
    recipients: ["adrian.aa.chang@gmail.com"],
    isDefault: true,
  },
  {
    id: "zh-contemporary",
    language: "zh",
    searchKeywords: CONTEMPORARY_KEYWORDS,
    recipients: ["ad841108@gmail.com", "adrian.aa.chang.aa@gmail.com"],
    isDefault: false,
  },
  {
    id: "en-souvenir",
    language: "en",
    searchKeywords: SOUVENIR_KEYWORDS,
    recipients: ["samlin001@gmail.com", "adrian.aa.chang.aa@gmail.com"],
    isDefault: false,
  },
];
