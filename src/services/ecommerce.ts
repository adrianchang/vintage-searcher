import eBayApi from "ebay-api";
import type { Listing } from "../types";

// Add more platforms here as we scale
export type Platform = "ebay";

// Set to true to use mock data for testing
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === "true";

// eBay API client
const eBay = new eBayApi({
  appId: process.env.EBAY_APP_ID || "",
  certId: process.env.EBAY_CERT_ID || "",
  sandbox: false,
  marketplaceId: eBayApi.MarketplaceId.EBAY_US,
});

// Search queries targeting casual sellers who may not know item value
const VINTAGE_SEARCH_QUERIES = [
  "old clothing estate sale",
  "grandma closet clothes",
  "antique clothes lot",
  "old jacket coat",
  "old dress clothing",
  "vintage clothing lot",
];

export async function fetchListings(platform: Platform, limit: number): Promise<Listing[]> {
  return fetchEbay(limit);
}

async function fetchEbay(limit: number): Promise<Listing[]> {
  if (USE_MOCK_DATA) {
    console.log(`[MOCK] Returning ${Math.min(limit, MOCK_LISTINGS.length)} mock listings`);
    return MOCK_LISTINGS.slice(0, limit);
  }

  console.log(`Fetching ${limit} listings from eBay...`);

  const listings: Listing[] = [];
  const perQueryLimit = Math.ceil(limit / VINTAGE_SEARCH_QUERIES.length);

  for (const query of VINTAGE_SEARCH_QUERIES) {
    if (listings.length >= limit) break;

    try {
      const response = await eBay.buy.browse.search({
        q: query,
        limit: String(perQueryLimit),
        filter: [
          "price:[0..500]",           // Under $500 (seller likely doesn't know value)
          "conditionIds:{1000|1500|2000|2500|3000}", // New to Good condition
        ].join(","),
        sort: "-itemCreationDate",    // Newest first
      });

      if (response.itemSummaries) {
        for (const item of response.itemSummaries) {
          if (listings.length >= limit) break;

          // Collect all image URLs
          const imageUrls: string[] = [];
          if (item.image?.imageUrl) {
            imageUrls.push(item.image.imageUrl);
          }
          if (item.additionalImages) {
            for (const img of item.additionalImages) {
              if (img.imageUrl) imageUrls.push(img.imageUrl);
            }
          }

          const listing: Listing = {
            url: item.itemWebUrl || "",
            platform: "ebay",
            title: item.title || "",
            price: parseFloat(item.price?.value || "0"),
            imageUrls,
            description: item.shortDescription || item.title || "",
            rawData: {
              itemId: item.itemId,
              condition: item.condition,
              conditionId: item.conditionId,
              seller: item.seller,
              itemCreationDate: item.itemCreationDate,
              categories: item.categories,
            },
          };

          listings.push(listing);
        }
      }

      console.log(`  Query "${query.slice(0, 30)}...": ${response.itemSummaries?.length || 0} results`);
    } catch (error) {
      console.error(`  Error searching "${query}":`, error);
    }
  }

  console.log(`Fetched ${listings.length} total listings from eBay`);
  return listings;
}

// Mock data for testing without API keys
const MOCK_LISTINGS: Listing[] = [
  {
    url: "https://www.ebay.com/itm/123456789001",
    platform: "ebay",
    title: "Vintage 1960s Pendleton Wool Board Shirt Mens Medium Blue Plaid Loop Collar",
    price: 45,
    imageUrls: [
      "https://i.ebayimg.com/images/g/mock1-main.jpg",
      "https://i.ebayimg.com/images/g/mock1-label.jpg",
      "https://i.ebayimg.com/images/g/mock1-detail.jpg",
    ],
    description: "Vintage Pendleton board shirt from the 1960s. Made in USA. Loop collar. Blue plaid pattern. Size Medium. Good vintage condition with minor wear.",
    rawData: {
      itemId: "123456789001",
      condition: "Pre-owned",
      seller: { username: "vintagethriftfinds", feedbackScore: 234 },
    },
  },
  {
    url: "https://www.ebay.com/itm/123456789002",
    platform: "ebay",
    title: "Old Dress Lot Vintage Clothing 50s 60s Reseller Bundle Mixed Sizes",
    price: 89,
    imageUrls: [
      "https://i.ebayimg.com/images/g/mock2-main.jpg",
      "https://i.ebayimg.com/images/g/mock2-pile.jpg",
    ],
    description: "Lot of old dresses from estate sale. Various sizes and conditions. Selling as-is. Great for resellers or crafters.",
    rawData: {
      itemId: "123456789002",
      condition: "Pre-owned",
      seller: { username: "estatesale_clearout", feedbackScore: 45 },
    },
  },
  {
    url: "https://www.ebay.com/itm/123456789003",
    platform: "ebay",
    title: "Vintage Levis 501 Jeans Big E Redline Selvedge 32x30 Single Stitch",
    price: 150,
    imageUrls: [
      "https://i.ebayimg.com/images/g/mock3-main.jpg",
      "https://i.ebayimg.com/images/g/mock3-tab.jpg",
      "https://i.ebayimg.com/images/g/mock3-selvedge.jpg",
      "https://i.ebayimg.com/images/g/mock3-stitching.jpg",
    ],
    description: "Authentic vintage Levis 501 jeans with Big E red tab. Selvedge denim with redline. Single stitch throughout. Some fading and wear consistent with age.",
    rawData: {
      itemId: "123456789003",
      condition: "Pre-owned",
      seller: { username: "denim_collector_tx", feedbackScore: 892 },
    },
  },
  {
    url: "https://www.ebay.com/itm/123456789004",
    platform: "ebay",
    title: "Grandmas Old Coat Wool Brown Womens Retro Style Winter Jacket",
    price: 25,
    imageUrls: [
      "https://i.ebayimg.com/images/g/mock4-main.jpg",
    ],
    description: "Cleaning out grandmas closet. Old brown wool coat. Not sure of the age but looks retro. Has some moth holes.",
    rawData: {
      itemId: "123456789004",
      condition: "Pre-owned",
      seller: { username: "cleaningouthouse", feedbackScore: 12 },
    },
  },
  {
    url: "https://www.ebay.com/itm/123456789005",
    platform: "ebay",
    title: "1950s Rockabilly Bowling Shirt Mens Large Chain Stitch Embroidery Two Tone",
    price: 35,
    imageUrls: [
      "https://i.ebayimg.com/images/g/mock5-main.jpg",
      "https://i.ebayimg.com/images/g/mock5-back.jpg",
      "https://i.ebayimg.com/images/g/mock5-embroidery.jpg",
    ],
    description: "Cool old bowling shirt. Has chain stitch embroidery on back that says 'Joes Auto Shop'. Two tone black and cream. Tag says Large.",
    rawData: {
      itemId: "123456789005",
      condition: "Pre-owned",
      seller: { username: "picker_mike", feedbackScore: 567 },
    },
  },
  {
    url: "https://www.ebay.com/itm/123456789006",
    platform: "ebay",
    title: "NEW Vintage Style Reproduction 1940s Dress Swing Dance Costume M",
    price: 65,
    imageUrls: [
      "https://i.ebayimg.com/images/g/mock6-main.jpg",
    ],
    description: "Brand new reproduction 1940s style swing dress. Great for dance events or Halloween. Modern sizing Medium.",
    rawData: {
      itemId: "123456789006",
      condition: "New with tags",
      seller: { username: "retrorepro_fashion", feedbackScore: 1205 },
    },
  },
  {
    url: "https://www.ebay.com/itm/123456789007",
    platform: "ebay",
    title: "Vintage 70s Landlubber Bell Bottoms Jeans High Waist 26x32 Deadstock NOS",
    price: 55,
    imageUrls: [
      "https://i.ebayimg.com/images/g/mock7-main.jpg",
      "https://i.ebayimg.com/images/g/mock7-label.jpg",
      "https://i.ebayimg.com/images/g/mock7-detail.jpg",
    ],
    description: "Deadstock vintage Landlubber bell bottom jeans from the 1970s. Never worn, still has original tags. High waist style. 26 inch waist, 32 inch inseam.",
    rawData: {
      itemId: "123456789007",
      condition: "New with tags",
      seller: { username: "deadstock_warehouse", feedbackScore: 2341 },
    },
  },
  {
    url: "https://www.ebay.com/itm/123456789008",
    platform: "ebay",
    title: "Old Work Jacket Chore Coat Denim Blanket Lined Vintage Workwear L",
    price: 40,
    imageUrls: [
      "https://i.ebayimg.com/images/g/mock8-main.jpg",
      "https://i.ebayimg.com/images/g/mock8-lining.jpg",
    ],
    description: "Old denim chore coat with blanket lining. Well worn with lots of character. No brand tag but looks old. Size Large approximately.",
    rawData: {
      itemId: "123456789008",
      condition: "Pre-owned",
      seller: { username: "barn_finds_ohio", feedbackScore: 89 },
    },
  },
  {
    url: "https://www.ebay.com/itm/123456789009",
    platform: "ebay",
    title: "Vintage ILGWU Union Made Sequin Evening Gown 1960s Cocktail Dress XS",
    price: 48,
    imageUrls: [
      "https://i.ebayimg.com/images/g/mock9-main.jpg",
      "https://i.ebayimg.com/images/g/mock9-label.jpg",
      "https://i.ebayimg.com/images/g/mock9-detail.jpg",
      "https://i.ebayimg.com/images/g/mock9-sequins.jpg",
    ],
    description: "Gorgeous vintage sequin evening gown. Has ILGWU union label dating it to 1960s. Black with silver sequins. Extra small size. Minor sequin loss.",
    rawData: {
      itemId: "123456789009",
      condition: "Pre-owned",
      seller: { username: "glamour_vintage", feedbackScore: 445 },
    },
  },
  {
    url: "https://www.ebay.com/itm/123456789010",
    platform: "ebay",
    title: "Carhartt Jacket Detroit Style Canvas Work Coat Mens XL Tan Duck",
    price: 75,
    imageUrls: [
      "https://i.ebayimg.com/images/g/mock10-main.jpg",
    ],
    description: "Carhartt Detroit jacket in tan duck canvas. Size XL. Normal wear and fading. Made in USA label.",
    rawData: {
      itemId: "123456789010",
      condition: "Pre-owned",
      seller: { username: "workwear_surplus", feedbackScore: 678 },
    },
  },
];
