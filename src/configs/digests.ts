export type KeywordConfig = { query: string; percentage: number };

export const DEFAULT_KEYWORDS: KeywordConfig[] = [
  { query: "vintage workwear jacket", percentage: 0.25 },
  { query: "vintage denim", percentage: 0.25 },
  { query: "vintage outerwear", percentage: 0.25 },
  { query: "vintage flannel shirt", percentage: 0.25 },
];

export const CONTEMPORARY_KEYWORDS: KeywordConfig[] = [
  { query: "vintage leather jacket", percentage: 0.25 },
  { query: "vintage outerwear", percentage: 0.25 },
  { query: "archive jacket", percentage: 0.25 },
  { query: "rare japanese jacket", percentage: 0.25 },
];

export const SOUVENIR_KEYWORDS: KeywordConfig[] = [
  { query: "vintage workwear jacket", percentage: 0.25 },
  { query: "vintage denim", percentage: 0.25 },
  { query: "vintage chinese souvenir jacket", percentage: 0.25 },
  { query: "vintage taiwan souvenir outerwear", percentage: 0.25 },
];
