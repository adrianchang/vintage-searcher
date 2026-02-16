import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client";
import { fetchListings } from "./services/ecommerce";
import { filterListings } from "./services/filter";
import { evaluateListing } from "./services/evaluate";
import { sendAlert } from "./services/notify";
import { runScan } from "./scan";
import type { ScanConfig } from "./types";

const config: ScanConfig = {
  platform: "ebay",
  maxListings: 20, // Limited to match Gemini free tier (20 requests/day)
  minMargin: 50,
  minConfidence: 0.7,
};

const prisma = new PrismaClient();

runScan(config, {
  prisma,
  fetchListings,
  filterListings,
  evaluateListing,
  sendAlert,
})
  .catch(console.error)
  .finally(() => prisma.$disconnect());
