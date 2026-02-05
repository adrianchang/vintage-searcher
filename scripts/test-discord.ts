import "dotenv/config";
import { sendAlert } from "../src/services/notify";
import type { Listing, Evaluation } from "../src/types";

// Test data
const testOpportunity = {
  listing: {
    url: "https://www.ebay.com/itm/test123",
    platform: "ebay",
    title: "TEST: 1950s Bowling Shirt Chain Stitch - Discord Test",
    price: 35,
    imageUrls: ["https://example.com/image.jpg"],
    description: "This is a test notification",
    rawData: {},
  } as Listing,
  evaluation: {
    isAuthentic: true,
    estimatedEra: "1950s",
    estimatedValue: 180,
    currentPrice: 35,
    margin: 145,
    confidence: 0.88,
    reasoning: "This is a test notification to verify Discord webhook is working correctly.",
    redFlags: ["This is a test - not a real listing"],
    references: ["Test reference 1", "Test reference 2"],
  } as Evaluation,
};

async function main() {
  if (!process.env.DISCORD_WEBHOOK_URL) {
    console.error("Error: DISCORD_WEBHOOK_URL not set in .env");
    process.exit(1);
  }

  console.log("Sending test notification to Discord...");
  await sendAlert([testOpportunity]);
  console.log("Done!");
}

main();
